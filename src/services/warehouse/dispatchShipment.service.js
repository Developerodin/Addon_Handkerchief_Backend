import httpStatus from 'http-status';
import mongoose from 'mongoose';
import ApiError from '../../utils/ApiError.js';
import { ProductionOrder } from '../../models/production.model.js';
import { DispatchBox, DispatchShipment } from '../../models/warehouse.model.js';
import { allocateDispatchShipmentCode } from './dispatchShipmentCode.js';
import { shipOneBox } from './boxShip.js';
import { writeOrderLog } from '../orderLog.service.js';

/**
 * @param {import('mongoose').Document} shipment
 */
const recalcTotals = (shipment) => {
  const lines = shipment.boxLines || [];
  shipment.boxCount = lines.length;
  shipment.pieceQty = lines.reduce((sum, row) => sum + (Number(row.pieceQty) || 0), 0);
  shipment.scaleWeight = lines.reduce((sum, row) => sum + (Number(row.scaleWeight) || 0), 0);
};

/**
 * @param {import('mongoose').Document} row
 */
export const shapeDispatchShipment = (row) => ({
  id: String(row._id || row.id),
  shipmentCode: row.shipmentCode,
  challanNumber: row.challanNumber || row.shipmentCode,
  productionOrderId: row.productionOrderId ? String(row.productionOrderId) : '',
  orderNumber: row.orderNumber || '',
  buyer: row.buyer || '',
  status: row.status,
  vehicleNumber: row.vehicleNumber || '',
  boxLines: (row.boxLines || []).map((line) => ({
    boxBarcode: line.boxBarcode,
    pieceQty: line.pieceQty || 0,
    scaleWeight: Number(line.scaleWeight) || 0,
    rackCode: line.rackCode || '',
    addedAt: line.addedAt,
  })),
  boxCount: row.boxCount || 0,
  pieceQty: row.pieceQty || 0,
  scaleWeight: Number(row.scaleWeight) || 0,
  dispatchedAt: row.dispatchedAt || null,
  dispatchedBy: row.dispatchedBy || '',
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

/**
 * Draft for this order, or create one.
 * @param {object} body
 * @param {object} [_params]
 * @param {object | null} [user]
 */
export const createOrOpenDraft = async (body, _params, user) => {
  const productionOrderId = String(body.productionOrderId || '').trim();
  if (!mongoose.Types.ObjectId.isValid(productionOrderId)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Production order is required');
  }
  const order = await ProductionOrder.findById(productionOrderId).select('orderNumber buyer dispatchTrackingClosedAt');
  if (!order) throw new ApiError(httpStatus.NOT_FOUND, 'Order not found');
  if (order.dispatchTrackingClosedAt) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Dispatch tracking is closed for this order');
  }
  const existing = await DispatchShipment.findOne({ productionOrderId, status: 'draft' });
  if (existing) return shapeDispatchShipment(existing);

  const shipmentCode = await allocateDispatchShipmentCode();
  const doc = await DispatchShipment.create({
    shipmentCode,
    challanNumber: shipmentCode,
    productionOrderId,
    orderNumber: order.orderNumber || '',
    buyer: order.buyer || '',
    status: 'draft',
  });
  await writeOrderLog(
    {
      action: 'dispatch-shipment-open',
      orderId: productionOrderId,
      entityType: 'dispatch-shipment',
      entityCode: shipmentCode,
    },
    user
  );
  return shapeDispatchShipment(doc);
};

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * @param {object} query
 */
export const listShipments = async (query = {}) => {
  const filter = {};
  if (query.status) filter.status = String(query.status);
  if (query.productionOrderId) filter.productionOrderId = query.productionOrderId;
  const q = String(query.q || query.orderNumber || '').trim();
  if (q) {
    const pattern = new RegExp(escapeRegex(q), 'i');
    filter.$or = [{ orderNumber: pattern }, { shipmentCode: pattern }, { vehicleNumber: pattern }, { buyer: pattern }];
  }
  const status = filter.status || '';
  const sort = status === 'dispatched' ? { dispatchedAt: -1, createdAt: -1 } : { updatedAt: -1 };
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 25));
  const skip = (page - 1) * limit;
  const totalResults = await DispatchShipment.countDocuments(filter);
  const rows = await DispatchShipment.find(filter).sort(sort).skip(skip).limit(limit);
  return {
    results: rows.map(shapeDispatchShipment),
    page,
    limit,
    totalResults,
    totalPages: Math.max(1, Math.ceil(totalResults / limit)),
  };
};

/**
 * @param {string} id
 */
export const getShipment = async (id) => {
  const row = await DispatchShipment.findById(id);
  if (!row) throw new ApiError(httpStatus.NOT_FOUND, 'Dispatch batch not found');
  return shapeDispatchShipment(row);
};

/**
 * @param {string} barcode
 */
const assertNotInOtherDraft = async (barcode, shipmentId) => {
  const other = await DispatchShipment.findOne({
    _id: { $ne: shipmentId },
    status: 'draft',
    'boxLines.boxBarcode': barcode,
  });
  if (other) {
    throw new ApiError(httpStatus.BAD_REQUEST, `Box is already on dispatch batch ${other.shipmentCode}`);
  }
};

/**
 * @param {object} body
 * @param {{ id: string }} params
 */
export const scanBoxIntoShipment = async (body, params, user) => {
  const shipment = await DispatchShipment.findById(params.id);
  if (!shipment || shipment.status !== 'draft') {
    throw new ApiError(httpStatus.BAD_REQUEST, 'This dispatch batch is not open');
  }
  const boxBarcode = String(body.boxBarcode || '').trim();
  if (!boxBarcode) throw new ApiError(httpStatus.BAD_REQUEST, 'Box barcode is required');
  if (shipment.boxLines.some((line) => line.boxBarcode === boxBarcode)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Box is already on this batch');
  }
  const box = await DispatchBox.findOne({ barcode: boxBarcode });
  if (!box || box.status !== 'on-rack') {
    throw new ApiError(httpStatus.BAD_REQUEST, 'This box is not on a rack');
  }
  if (String(box.productionOrderId) !== String(shipment.productionOrderId)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'This box belongs to a different order');
  }
  await assertNotInOtherDraft(boxBarcode, shipment.id);
  shipment.boxLines.push({
    boxBarcode: box.barcode,
    pieceQty: box.pieceQty || 0,
    scaleWeight: Number(box.scaleWeight) || 0,
    rackCode: box.rackCode || '',
    addedAt: new Date(),
  });
  recalcTotals(shipment);
  await shipment.save();
  await writeOrderLog(
    {
      action: 'dispatch-shipment-scan',
      orderId: shipment.productionOrderId,
      entityType: 'box',
      entityCode: box.barcode,
      remarks: shipment.shipmentCode,
    },
    user
  );
  return shapeDispatchShipment(shipment);
};

/**
 * @param {{ id: string, barcode: string }} params
 */
export const removeLineFromShipment = async (_body, params, user) => {
  const shipment = await DispatchShipment.findById(params.id);
  if (!shipment || shipment.status !== 'draft') {
    throw new ApiError(httpStatus.BAD_REQUEST, 'This dispatch batch is not open');
  }
  const barcode = String(params.barcode || '').trim();
  const before = shipment.boxLines.length;
  shipment.boxLines = shipment.boxLines.filter((line) => line.boxBarcode !== barcode);
  if (shipment.boxLines.length === before) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Box is not on this batch');
  }
  recalcTotals(shipment);
  await shipment.save();
  await writeOrderLog(
    {
      action: 'dispatch-shipment-unscan',
      orderId: shipment.productionOrderId,
      entityType: 'box',
      entityCode: barcode,
      remarks: shipment.shipmentCode,
    },
    user
  );
  return shapeDispatchShipment(shipment);
};

/**
 * @param {object} body
 * @param {{ id: string }} params
 */
export const dispatchShipment = async (body, params, user) => {
  if (body.site === 'cloud') throw new ApiError(httpStatus.FORBIDDEN, 'Cloud cannot dispatch a box');
  const vehicle = String(body.vehicleNumber || '').trim();
  if (!vehicle) throw new ApiError(httpStatus.BAD_REQUEST, 'Vehicle number is required');
  const shipment = await DispatchShipment.findById(params.id);
  if (!shipment) throw new ApiError(httpStatus.NOT_FOUND, 'Dispatch batch not found');
  if (shipment.status === 'dispatched') return shapeDispatchShipment(shipment);
  if (shipment.status !== 'draft') throw new ApiError(httpStatus.BAD_REQUEST, 'This dispatch batch cannot be shipped');
  if (!shipment.boxLines.length) throw new ApiError(httpStatus.BAD_REQUEST, 'Scan at least one box');

  const rootEventId = String(body.eventId || `dsp-${shipment.shipmentCode}`).trim();

  for (const line of shipment.boxLines) {
    const box = await DispatchBox.findOne({ barcode: line.boxBarcode });
    if (!box) throw new ApiError(httpStatus.BAD_REQUEST, `Box ${line.boxBarcode} not found`);
    const eventId = `${rootEventId}-${line.boxBarcode}`;
    try {
      await shipOneBox({ box, vehicle, eventId, shipmentId: shipment.id }, user);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Dispatch failed';
      throw new ApiError(httpStatus.BAD_REQUEST, message);
    }
  }

  shipment.status = 'dispatched';
  shipment.vehicleNumber = vehicle;
  shipment.dispatchedAt = new Date();
  shipment.dispatchedBy = user?.name || user?.email || '';
  await shipment.save();

  await writeOrderLog(
    {
      action: 'dispatch-shipment-complete',
      orderId: shipment.productionOrderId,
      entityType: 'dispatch-shipment',
      entityCode: shipment.shipmentCode,
      quantity: shipment.pieceQty,
      remarks: vehicle,
    },
    user
  );

  return shapeDispatchShipment(shipment);
};

/**
 * @param {object} _body
 * @param {{ orderId: string }} params
 */
export const closeDispatchTracking = async (_body, params, user) => {
  const order = await ProductionOrder.findById(params.orderId);
  if (!order) throw new ApiError(httpStatus.NOT_FOUND, 'Order not found');
  order.dispatchTrackingClosedAt = new Date();
  await order.save();
  await writeOrderLog(
    {
      action: 'dispatch-tracking-closed',
      orderId: order.id,
      entityType: 'order',
      entityCode: order.orderNumber || String(order.id),
    },
    user
  );
  return {
    orderId: String(order.id),
    orderNumber: order.orderNumber || '',
    dispatchTrackingClosedAt: order.dispatchTrackingClosedAt,
  };
};

/**
 * Map productionOrderId → draft shipment id (if any).
 */
export const draftShipmentIdsByOrder = async () => {
  const drafts = await DispatchShipment.find({ status: 'draft' }).select('productionOrderId shipmentCode boxCount');
  const map = new Map();
  for (const row of drafts) {
    map.set(String(row.productionOrderId), {
      openShipmentId: String(row._id),
      openShipmentCode: row.shipmentCode,
      draftBoxCount: row.boxCount || 0,
    });
  }
  return map;
};

/**
 * Barcodes currently on any draft shipment (for rack UI hints).
 */
export const draftBoxBarcodes = async () => {
  const drafts = await DispatchShipment.find({ status: 'draft' }).select('boxLines');
  const set = new Set();
  for (const row of drafts) {
    for (const line of row.boxLines || []) set.add(line.boxBarcode);
  }
  return set;
};