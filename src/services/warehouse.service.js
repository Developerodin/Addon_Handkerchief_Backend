import httpStatus from 'http-status';
import ApiError from '../utils/ApiError.js';
import { ClientOrder, DispatchBox, FactoryClient, PackingBundle } from '../models/warehouse.model.js';
import { StockMovement } from '../models/store.model.js';
import { finalGoodQty } from './quality.service.js';
import { nextCode } from './factory/ids.js';
import { writeOrderLog } from './orderLog.service.js';

/**
 * @param {object} body
 */
export const createClient = async (body) => FactoryClient.create(body);

/**
 * Copies the address onto the order so a later master edit does not rewrite it.
 * @param {object} body
 */
export const createClientOrder = async (body) => {
  const client = await FactoryClient.findById(body.clientId);
  if (!client) throw new ApiError(httpStatus.NOT_FOUND, 'Client not found');
  return ClientOrder.create({
    clientId: client.id,
    clientName: client.name,
    clientAddress: client.address,
    targetBoxes: body.targetBoxes || 1,
  });
};

/**
 * Packing only takes quantity that final QC marked good and that sits on the packing rack.
 * @param {object} body
 * @param {object} [_params]
 * @param {object | null} [user]
 */
export const createPackingBundle = async (body, _params, user) => {
  const allowed = await finalGoodQty(body.orderId);
  const already = await PackingBundle.aggregate([
    { $match: { orderId: body.orderId } },
    { $group: { _id: null, qty: { $sum: '$qty' } } },
  ]);
  const used = already[0]?.qty || 0;
  if (used + body.qty > allowed) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Packing refuses quantity that is not final-good');
  }
  const bundle = await PackingBundle.create({
    barcode: body.barcode || nextCode('PB'),
    orderId: body.orderId,
    qty: body.qty,
    revisionId: body.revisionId || '',
    onPackingRack: true,
  });
  await writeOrderLog(
    {
      action: 'packing',
      orderId: body.orderId,
      entityType: 'bundle',
      entityCode: bundle.barcode,
      quantity: body.qty,
    },
    user
  );
  return bundle;
};

/**
 * @param {object} body
 */
export const createBox = async (body) => {
  const bundles = await PackingBundle.find({ barcode: { $in: body.packingBundleBarcodes } });
  if (bundles.length !== body.packingBundleBarcodes.length) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Every packing bundle must already exist');
  }
  if (bundles.some((row) => !row.onPackingRack)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Packing refuses quantity that is not on the packing rack');
  }
  return DispatchBox.create({
    barcode: body.barcode || nextCode('BOX'),
    clientOrderId: body.clientOrderId,
    productionOrderId: body.productionOrderId,
    revisionId: body.revisionId || bundles[0].revisionId,
    packingBundleIds: bundles.map((row) => row.barcode),
    scaleWeight: body.scaleWeight,
    rollBarcode: body.rollBarcode || '',
    poId: body.poId || '',
    status: 'open',
  });
};

/**
 * @param {{ boxBarcode: string, rackCode: string }} body
 * @param {object} [_params]
 * @param {object | null} [user]
 */
export const rackBox = async (body, _params, user) => {
  const box = await DispatchBox.findOne({ barcode: body.boxBarcode });
  if (!box) throw new ApiError(httpStatus.NOT_FOUND, 'Box not found');
  box.rackCode = body.rackCode;
  box.status = 'on-rack';
  await box.save();
  await StockMovement.create({
    entityType: 'box',
    entityId: box.barcode,
    kind: 'rack',
    toLocation: body.rackCode,
    quantity: 1,
  });
  await writeOrderLog(
    {
      action: 'box-rack',
      orderId: box.productionOrderId,
      entityType: 'box',
      entityCode: box.barcode,
      toLocation: body.rackCode,
    },
    user
  );
  return box;
};

/**
 * Same event does not ship the box twice. Cloud cannot scan a box out.
 * @param {{ boxBarcode: string, eventId: string, site?: string }} body
 * @param {object} [_params]
 * @param {object | null} [user]
 */
export const dispatchBox = async (body, _params, user) => {
  if (body.site === 'cloud') throw new ApiError(httpStatus.FORBIDDEN, 'Cloud cannot dispatch a box');
  const existing = await DispatchBox.findOne({ eventId: body.eventId });
  if (existing) return existing;
  const box = await DispatchBox.findOne({ barcode: body.boxBarcode });
  if (!box || box.status === 'dispatched') {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Box is not on a rack');
  }
  const order = await ClientOrder.findById(box.clientOrderId);
  box.eventId = body.eventId;
  box.status = 'dispatched';
  box.clientAddress = order?.clientAddress || '';
  await box.save();
  await StockMovement.create({
    eventId: body.eventId,
    entityType: 'box',
    entityId: box.barcode,
    kind: 'dispatch',
    fromLocation: box.rackCode,
    toLocation: 'dispatched',
    quantity: 1,
  });
  await writeOrderLog(
    {
      action: 'dispatch',
      orderId: box.productionOrderId,
      entityType: 'box',
      entityCode: box.barcode,
      fromLocation: box.rackCode,
      toLocation: 'dispatched',
    },
    user
  );
  if (order) {
    const left = await DispatchBox.countDocuments({ clientOrderId: order.id, status: { $ne: 'dispatched' } });
    order.status = left > 0 ? 'partially-dispatched' : 'dispatched';
    await order.save();
  }
  return box;
};

/**
 * Walks box to packing bundles, production order, roll, and PO.
 * @param {string} boxBarcode
 */
export const traceBox = async (boxBarcode) => {
  const box = await DispatchBox.findOne({ barcode: boxBarcode });
  if (!box) throw new ApiError(httpStatus.NOT_FOUND, 'Box not found');
  const bundles = await PackingBundle.find({ barcode: { $in: box.packingBundleIds } });
  return {
    box,
    bundles,
    productionOrderId: box.productionOrderId,
    revisionId: box.revisionId,
    rollBarcode: box.rollBarcode,
    poId: box.poId,
  };
};

/**
 * Boxes whose latest movement is still the rack.
 * @param {string} rackCode
 */
export const boxesOnRack = async (rackCode) => {
  const rows = await StockMovement.find({ entityType: 'box' }).sort({ createdAt: 1 });
  const latest = new Map();
  rows.forEach((row) => latest.set(row.entityId, row));
  const barcodes = [];
  latest.forEach((row, barcode) => {
    if (row.toLocation === rackCode) barcodes.push(barcode);
  });
  return barcodes;
};
