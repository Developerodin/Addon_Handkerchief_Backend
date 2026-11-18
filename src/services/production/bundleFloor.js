import httpStatus from 'http-status';
import ApiError from '../../utils/ApiError.js';
import { PieceBundle, ProductionOrder } from '../../models/production.model.js';
import { completedBundlesFromLogs } from './floorCompleted.js';
import Machine from '../../models/machine.model.js';
import ProductionRack from '../../models/productionRack.model.js';
import Container from '../../models/container.model.js';
import { writeOrderLog } from '../orderLog.service.js';

/**
 * Unique scanned bundle barcodes.
 * @param {string[] | undefined} barcodes
 */
export const bundleCodes = (barcodes) => [...new Set((barcodes || []).map((code) => String(code || '').trim()).filter(Boolean))];

/**
 * Active rack matched by code or barcode.
 * @param {string} scanned
 */
export const activeRack = async (scanned) => {
  const rack = await ProductionRack.findOne({
    status: 'active',
    $or: [{ code: String(scanned || '').toUpperCase() }, { barcode: scanned }, { barcode: String(scanned || '').toUpperCase() }],
  });
  if (!rack) throw new ApiError(httpStatus.BAD_REQUEST, 'Rack not found');
  return rack;
};

/**
 * Active rack that holds the given stock.
 * @param {string} scanned
 * @param {string} stockType
 * @param {string} message
 */
export const rackOfType = async (scanned, stockType, message) => {
  const rack = await activeRack(scanned);
  if (rack.stockType !== stockType) throw new ApiError(httpStatus.BAD_REQUEST, message);
  return rack;
};

/**
 * Active bundle container.
 * @param {string} scanned
 */
export const bundleContainer = async (scanned) => {
  const code = String(scanned || '').trim();
  const container = await Container.findOne({
    status: 'active',
    $or: [{ code: code.toUpperCase() }, { barcode: code }, { barcode: code.toUpperCase() }],
  });
  if (!container) throw new ApiError(httpStatus.BAD_REQUEST, 'Container not found');
  if (container.type !== 'bundle') throw new ApiError(httpStatus.BAD_REQUEST, 'This container is not for bundles');
  return container;
};

/**
 * Active machine or table.
 * @param {string} scanned
 * @param {string} missing
 */
export const activeMachine = async (scanned, missing) => {
  const machine = await Machine.findOne({ barcode: String(scanned || '').trim(), status: 'active' });
  if (!machine) throw new ApiError(httpStatus.BAD_REQUEST, missing);
  return machine;
};

/**
 * Bundles for every scanned barcode.
 * @param {string[]} codes
 */
export const loadBundles = async (codes) => {
  const bundles = await PieceBundle.find({ barcode: { $in: codes } });
  if (bundles.length !== codes.length) throw new ApiError(httpStatus.BAD_REQUEST, 'Bundle not found');
  return bundles;
};

/**
 * @param {object[]} rows
 */
export const orderMap = async (rows) => {
  const orders = await ProductionOrder.find({ _id: { $in: [...new Set(rows.map((row) => String(row.orderId)))] } }).select(
    'orderNumber productionType lines'
  );
  return new Map(orders.map((order) => [String(order.id), order]));
};

/**
 * Pieces that may move to the next floor after final QC (defects stay behind).
 * @param {{ finalGood?: number, qty?: number }} bundle
 */
export const transferableQty = (bundle) => {
  const good = Number(bundle?.finalGood) || 0;
  if (good > 0) return good;
  return Number(bundle?.qty) || 0;
};

/**
 * @param {object} row
 * @param {Map<string, object>} orders
 */
export const shapeBundle = (row, orders) => {
  const order = orders.get(String(row.orderId));
  return {
    id: String(row.id || row._id),
    barcode: row.barcode || '',
    orderId: String(row.orderId),
    orderNumber: order?.orderNumber || '',
    productionType: order?.productionType || '',
    qty: row.qty || 0,
    m4Qty: row.m4Qty || 0,
    finalGood: row.finalGood || 0,
    packedQty: row.packedQty || 0,
    rackCode: row.rackCode || '',
    machineBarcode: row.machineBarcode || '',
    containerBarcode: row.containerBarcode || '',
    process: row.process || 'created',
    route: row.route || '',
    checkedGood: Boolean(row.checkedGood),
    status: row.status || 'closed',
  };
};

/**
 * @param {object[]} bundles
 * @param {object} entry
 * @param {object | null} user
 * @param {import('mongoose').ClientSession | null} [session]
 */
export const logBundles = (bundles, entry, user, session = null) => {
  const orderIds = new Set(bundles.map((bundle) => String(bundle.orderId)));
  return writeOrderLog(
    {
      ...entry,
      orderId: orderIds.size === 1 ? bundles[0].orderId : undefined,
      entityType: 'bundle',
      entityCode: bundles[0].barcode,
      quantity: bundles.reduce((sum, bundle) => sum + transferableQty(bundle), 0),
    },
    user,
    session
  );
};

/**
 * Waiting rows plus rows already on a station, with today's count.
 * @param {object} waitingQuery
 * @param {object} activeQuery
 * @param {object} doneQuery
 * @param {object} rackQuery
 * @param {string[]} [doneActions]
 */
export const boardFor = async (waitingQuery, activeQuery, doneQuery, rackQuery, doneActions = []) => {
  const [waiting, active] = await Promise.all([
    PieceBundle.find(waitingQuery).sort({ updatedAt: -1 }).limit(200),
    PieceBundle.find(activeQuery).sort({ updatedAt: -1 }).limit(200),
  ]);
  const orders = await orderMap([...waiting, ...active]);
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const [doneToday, onRack, completed] = await Promise.all([
    PieceBundle.countDocuments({ ...doneQuery, updatedAt: { $gte: start } }),
    PieceBundle.countDocuments(rackQuery),
    completedBundlesFromLogs(doneActions),
  ]);
  return {
    results: waiting.map((row) => shapeBundle(row, orders)),
    active: active.map((row) => shapeBundle(row, orders)),
    completed,
    counts: {
      waiting: waiting.length,
      onStation: active.length,
      doneToday,
      onRack,
      completed: completed.length,
    },
  };
};
