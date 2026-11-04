import httpStatus from 'http-status';
import ApiError from '../../utils/ApiError.js';
import { PieceBundle, ProductionOrder } from '../../models/production.model.js';
import { QualityResult } from '../../models/quality.model.js';
import { ClientOrder, DispatchBox, PackingBundle } from '../../models/warehouse.model.js';
import { StockMovement } from '../../models/store.model.js';
import Product from '../../models/product.model.js';
import StyleCode from '../../models/styleCode.model.js';
import StorageRack from '../../models/storageRack.model.js';
import { nextCode } from '../factory/ids.js';
import { orderMap, rackOfType, shapeBundle } from '../production/bundleFloor.js';
import { writeOrderLog } from '../orderLog.service.js';

/**
 * Whole count, or zero when the field is blank.
 * @param {unknown} value
 */
const whole = (value) => {
  const count = value == null || value === '' ? 0 : Number(value);
  if (!Number.isInteger(count) || count < 0) return null;
  return count;
};

/**
 * Pieces in one packing bundle for this production order's item.
 * @param {string} orderId
 */
const packingSize = async (orderId) => {
  const order = await ProductionOrder.findById(orderId);
  if (!order?.itemId) throw new ApiError(httpStatus.BAD_REQUEST, 'This item has no packing size');
  const product = await Product.findById(order.itemId).select('styleCodes');
  const styleId = product?.styleCodes?.[0];
  const style = styleId
    ? await StyleCode.findById(styleId)
    : await StyleCode.findOne({ linkedItem: order.itemId, status: 'active' });
  const size = style?.packingBundleQty;
  if (!size || size < 60 || size > 120) throw new ApiError(httpStatus.BAD_REQUEST, 'This item has no packing size');
  return { order, size };
};

/**
 * Closed bundle on a packing rack with a final-checking result and pieces left.
 * @param {string} barcode
 */
const readyToPack = async (barcode) => {
  const bundle = await PieceBundle.findOne({ barcode: String(barcode || '').trim() });
  if (!bundle || !bundle.closed || !bundle.rackCode) throw new ApiError(httpStatus.BAD_REQUEST, 'This bundle is not ready for packing');
  const result = await QualityResult.findOne({ kind: 'final-checking', bundleId: String(bundle.id) });
  if (!result) throw new ApiError(httpStatus.BAD_REQUEST, 'This bundle is not ready for packing');
  const rack = await StorageRack.findOne({ status: 'active', code: String(bundle.rackCode).toUpperCase() });
  if (!rack || rack.stockType !== 'packing') throw new ApiError(httpStatus.BAD_REQUEST, 'This bundle is not ready for packing');
  return bundle;
};

/**
 * Piece bundles that still have final-checking good quantity, plus packing bundles not yet in a box.
 */
export const upcomingPacking = async () => {
  const racks = await StorageRack.find({ status: 'active', stockType: 'packing' }).select('code');
  const rows = await PieceBundle.find({
    closed: true,
    rackCode: { $in: racks.map((rack) => rack.code) },
    finalGood: { $gt: 0 },
  })
    .sort({ updatedAt: -1 })
    .limit(200);
  const checked = await QualityResult.find({
    kind: 'final-checking',
    bundleId: { $in: rows.map((row) => String(row.id)) },
  }).select('bundleId');
  const allowed = new Set(checked.map((row) => String(row.bundleId)));
  const waiting = rows.filter((row) => allowed.has(String(row.id)) && row.finalGood - (row.packedQty || 0) > 0);
  const loose = await PackingBundle.find({ boxBarcode: '' }).sort({ createdAt: -1 }).limit(200);
  const orders = await orderMap([...waiting, ...loose.map((row) => ({ orderId: row.orderId }))]);
  const sizes = new Map();
  await Promise.all(
    [...new Set(waiting.map((row) => String(row.orderId)))].map(async (orderId) => {
      try {
        sizes.set(orderId, (await packingSize(orderId)).size);
      } catch (err) {
        if (!(err instanceof ApiError)) throw err;
        sizes.set(orderId, 0);
      }
    })
  );
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const boxedToday = await DispatchBox.countDocuments({ createdAt: { $gte: start } });
  return {
    results: waiting.map((row) => ({ ...shapeBundle(row, orders), packingSize: sizes.get(String(row.orderId)) || 0 })),
    loose: loose.map((row) => ({
      id: String(row.id),
      barcode: row.barcode,
      qty: row.qty,
      orderId: String(row.orderId || ''),
      orderNumber: orders.get(String(row.orderId))?.orderNumber || '',
      pieceBundleBarcode: row.pieceBundleBarcode || '',
    })),
    counts: { waiting: waiting.length, onStation: loose.length, doneToday: boxedToday, onRack: loose.length },
  };
};

/**
 * Cuts one packing bundle off the final-checking remainder and gives it a barcode.
 * @param {object} body
 * @param {object} [_params]
 * @param {object | null} [user]
 */
export const packPieces = async (body, _params, user) => {
  const count = whole(body.pieceCount);
  if (count == null) throw new ApiError(httpStatus.BAD_REQUEST, 'Piece count is invalid');
  if (count < 1) throw new ApiError(httpStatus.BAD_REQUEST, 'Piece count is required');
  const bundle = await readyToPack(body.bundleBarcode);
  const remaining = bundle.finalGood - (bundle.packedQty || 0);
  if (remaining < 1) throw new ApiError(httpStatus.BAD_REQUEST, 'This bundle is not ready for packing');
  if (count > remaining) throw new ApiError(httpStatus.BAD_REQUEST, 'This count is more than what is left');
  const { order, size } = await packingSize(bundle.orderId);
  const last = remaining < size && count === remaining;
  if (count !== size && !last) throw new ApiError(httpStatus.BAD_REQUEST, 'Piece count must match the packing size');
  const row = await PackingBundle.create({
    barcode: nextCode('PB'),
    orderId: bundle.orderId,
    qty: count,
    pieceBundleBarcode: bundle.barcode,
    revisionId: order.revisionId || '',
    onPackingRack: true,
  });
  bundle.packedQty = (bundle.packedQty || 0) + count;
  await bundle.save();
  await writeOrderLog(
    {
      action: 'packing',
      orderId: bundle.orderId,
      entityType: 'bundle',
      entityCode: row.barcode,
      quantity: count,
      fromLocation: bundle.rackCode,
    },
    user
  );
  return row;
};

/**
 * Distinct scanned packing-bundle barcodes.
 * @param {string[] | undefined} barcodes
 */
const packCodes = (barcodes) => [...new Set((barcodes || []).map((code) => String(code || '').trim()).filter(Boolean))];

/**
 * Puts unpacked packing bundles into one box. The box is not weighed here.
 * @param {object} body
 * @param {object} [_params]
 * @param {object | null} [user]
 */
export const sealBox = async (body, _params, user) => {
  const codes = packCodes(body.packingBundleBarcodes);
  if (!codes.length) throw new ApiError(httpStatus.BAD_REQUEST, 'Packing bundle barcode is required');
  const bundles = await PackingBundle.find({ barcode: { $in: codes } });
  if (bundles.length !== codes.length) throw new ApiError(httpStatus.BAD_REQUEST, 'Every packing bundle must already exist');
  if (bundles.some((row) => row.boxBarcode)) throw new ApiError(httpStatus.BAD_REQUEST, 'This packing bundle is already in a box');
  const orderIds = new Set(bundles.map((row) => String(row.orderId)));
  if (orderIds.size !== 1) throw new ApiError(httpStatus.BAD_REQUEST, 'Packing bundles must be from one order');
  const pieceQty = bundles.reduce((sum, row) => sum + row.qty, 0);
  const box = await DispatchBox.create({
    barcode: nextCode('BOX'),
    clientOrderId: body.clientOrderId || undefined,
    productionOrderId: bundles[0].orderId,
    revisionId: bundles[0].revisionId || '',
    packingBundleIds: bundles.map((row) => row.barcode),
    pieceQty,
    scaleWeight: 0,
    status: 'open',
  });
  await PackingBundle.updateMany({ barcode: { $in: codes } }, { boxBarcode: box.barcode, onPackingRack: false });
  await writeOrderLog(
    {
      action: 'box-pack',
      orderId: bundles[0].orderId,
      entityType: 'box',
      entityCode: box.barcode,
      quantity: pieceQty,
    },
    user
  );
  return box;
};

/**
 * Open boxes waiting for a weight, and weighed boxes waiting for a rack.
 */
export const upcomingBoxes = async () => {
  const [open, weighed] = await Promise.all([
    DispatchBox.find({ status: 'open' }).sort({ updatedAt: -1 }).limit(200),
    DispatchBox.find({ status: 'weighed' }).sort({ updatedAt: -1 }).limit(200),
  ]);
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const storedToday = await DispatchBox.countDocuments({ status: 'on-rack', updatedAt: { $gte: start } });
  return {
    results: open,
    active: weighed,
    counts: { waiting: open.length, onStation: weighed.length, doneToday: storedToday, onRack: storedToday },
  };
};

/**
 * Stores the typed scale weight. Zero and a blank are refused.
 * @param {object} body
 */
export const weighBox = async (body) => {
  const box = await DispatchBox.findOne({ barcode: String(body.boxBarcode || '').trim() });
  if (!box) throw new ApiError(httpStatus.BAD_REQUEST, 'Box not found');
  if (box.status === 'weighed') throw new ApiError(httpStatus.BAD_REQUEST, 'This box is already weighed');
  if (box.status !== 'open') throw new ApiError(httpStatus.BAD_REQUEST, 'This box is not open');
  const weight = body.scaleWeight == null || body.scaleWeight === '' ? NaN : Number(body.scaleWeight);
  if (!Number.isFinite(weight) || weight <= 0) throw new ApiError(httpStatus.BAD_REQUEST, 'Scale weight is required');
  box.scaleWeight = weight;
  box.status = 'weighed';
  await box.save();
  return box;
};

/**
 * Puts a weighed box on a box rack. A bundles rack or a packing rack is refused.
 * @param {object} body
 * @param {object} [_params]
 * @param {object | null} [user]
 */
export const storeBox = async (body, _params, user) => {
  const box = await DispatchBox.findOne({ barcode: String(body.boxBarcode || '').trim() });
  if (!box) throw new ApiError(httpStatus.BAD_REQUEST, 'Box not found');
  if (box.status === 'on-rack') throw new ApiError(httpStatus.BAD_REQUEST, 'This box is already on a rack');
  if (box.status !== 'weighed') throw new ApiError(httpStatus.BAD_REQUEST, 'This box is not weighed');
  const rack = await rackOfType(body.rackCode, 'box', 'This rack is not for boxes');
  box.rackCode = rack.code;
  box.status = 'on-rack';
  await box.save();
  await StockMovement.create({
    entityType: 'box',
    entityId: box.barcode,
    kind: 'rack',
    toLocation: rack.code,
    quantity: 1,
    orderId: box.productionOrderId,
  });
  await writeOrderLog(
    {
      action: 'box-rack',
      orderId: box.productionOrderId,
      entityType: 'box',
      entityCode: box.barcode,
      toLocation: rack.code,
    },
    user
  );
  return box;
};

/**
 * Boxes sitting on a rack.
 */
export const upcomingDispatch = async () => {
  const rows = await DispatchBox.find({ status: 'on-rack' }).sort({ updatedAt: -1 }).limit(200);
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const doneToday = await DispatchBox.countDocuments({ status: 'dispatched', updatedAt: { $gte: start } });
  return {
    results: rows,
    counts: { waiting: rows.length, onStation: 0, doneToday, onRack: rows.length },
  };
};

/**
 * Scans one on-rack box out. The same event does not ship it twice.
 * @param {object} body
 * @param {object} [_params]
 * @param {object | null} [user]
 */
export const shipBox = async (body, _params, user) => {
  if (body.site === 'cloud') throw new ApiError(httpStatus.FORBIDDEN, 'Cloud cannot dispatch a box');
  const vehicle = String(body.vehicleNumber || '').trim();
  if (!vehicle) throw new ApiError(httpStatus.BAD_REQUEST, 'Vehicle number is required');
  const eventId = String(body.eventId || '').trim();
  if (!eventId) throw new ApiError(httpStatus.BAD_REQUEST, 'Event is required');
  const existing = await DispatchBox.findOne({ eventId });
  if (existing) return existing;
  const box = await DispatchBox.findOne({ barcode: String(body.boxBarcode || '').trim() });
  if (!box || box.status !== 'on-rack') throw new ApiError(httpStatus.BAD_REQUEST, 'This box is not on a rack');
  const order = box.clientOrderId ? await ClientOrder.findById(box.clientOrderId) : null;
  const fromRack = box.rackCode;
  box.eventId = eventId;
  box.status = 'dispatched';
  box.vehicleNumber = vehicle;
  box.clientAddress = order?.clientAddress || box.clientAddress || '';
  await box.save();
  await StockMovement.create({
    eventId,
    entityType: 'box',
    entityId: box.barcode,
    kind: 'dispatch',
    fromLocation: fromRack,
    toLocation: 'dispatched',
    quantity: 1,
    orderId: box.productionOrderId,
  });
  await writeOrderLog(
    {
      action: 'dispatch',
      orderId: box.productionOrderId,
      entityType: 'box',
      entityCode: box.barcode,
      fromLocation: fromRack,
      toLocation: 'dispatched',
      remarks: vehicle,
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
