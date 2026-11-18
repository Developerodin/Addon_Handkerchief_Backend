import httpStatus from 'http-status';
import ApiError from '../../utils/ApiError.js';
import { PieceBundle, ProductionOrder } from '../../models/production.model.js';
import Machine from '../../models/machine.model.js';
import { logBundles, rackOfType } from './bundleFloor.js';
import { txnEntityUpdate } from './floorTxn.js';
import { completedBundlesFromLogs } from './floorCompleted.js';

/**
 * Active bundles rack, matched by code or barcode.
 * @param {string} scanned
 */
const bundlesRack = (scanned) => rackOfType(scanned, 'bundles', 'This rack is not for bundles');

/**
 * Unique scanned bundle barcodes.
 * @param {string[] | undefined} barcodes
 */
const bundleCodes = (barcodes) => [...new Set((barcodes || []).map((code) => String(code || '').trim()).filter(Boolean))];

/**
 * @param {object} row
 * @param {Map<string, string>} orderNumbers
 */
const shapeBundle = (row, orderNumbers) => ({
  id: String(row.id || row._id),
  barcode: row.barcode || '',
  orderId: String(row.orderId),
  orderNumber: orderNumbers.get(String(row.orderId)) || '',
  qty: row.qty || 0,
  rackCode: row.rackCode || '',
  machineBarcode: row.machineBarcode || '',
  process: row.process || 'created',
  checkedGood: Boolean(row.checkedGood),
  status: row.status || 'closed',
});

/**
 * @param {object[]} rows
 */
const orderNumbersFor = async (rows) => {
  const orders = await ProductionOrder.find({ _id: { $in: [...new Set(rows.map((row) => String(row.orderId)))] } })
    .select('orderNumber')
    .lean();
  return new Map(orders.map((order) => [String(order._id), order.orderNumber || '']));
};

/**
 * Hemmed bundles on a rack, plus bundles already on a thread-cutting table.
 */
export const upcomingThreadCut = async () => {
  const waitingQuery = { closed: true, process: 'horizontal-hem', rackCode: { $nin: ['', null] } };
  const activeQuery = { closed: true, process: 'horizontal-hem', rackCode: { $in: ['', null] }, machineBarcode: { $nin: ['', null] } };
  const [waiting, active] = await Promise.all([
    PieceBundle.find(waitingQuery).sort({ updatedAt: -1 }).limit(200).lean(),
    PieceBundle.find(activeQuery).sort({ updatedAt: -1 }).limit(200).lean(),
  ]);
  const orderNumbers = await orderNumbersFor([...waiting, ...active]);
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const [doneToday, onRack] = await Promise.all([
    PieceBundle.countDocuments({ process: 'thread-cut', updatedAt: { $gte: start } }),
    PieceBundle.countDocuments({ process: 'thread-cut', rackCode: { $nin: ['', null] } }),
  ]);
  const completed = await completedBundlesFromLogs(['thread-cut-done']);
  return {
    results: waiting.map((row) => shapeBundle(row, orderNumbers)),
    active: active.map((row) => shapeBundle(row, orderNumbers)),
    completed,
    counts: { waiting: waiting.length, onTable: active.length, doneToday, onRack, completed: completed.length },
  };
};

/**
 * Picks hemmed bundles off a bundles rack onto the thread-cutting table.
 * @param {{ bundleBarcodes?: string[], rackCode?: string, machineBarcode?: string }} body
 * @param {object} [_params]
 * @param {object | null} [user]
 */
export const startThreadCut = async (body, _params, user) => {
  const codes = bundleCodes(body.bundleBarcodes);
  const rackCode = String(body.rackCode || '').trim();
  const machineBarcode = String(body.machineBarcode || '').trim();
  if (!codes.length) throw new ApiError(httpStatus.BAD_REQUEST, 'Bundle barcodes are required');
  if (!rackCode) throw new ApiError(httpStatus.BAD_REQUEST, 'Rack is required');
  if (!machineBarcode) throw new ApiError(httpStatus.BAD_REQUEST, 'Table barcode is required');
  const machine = await Machine.findOne({ barcode: machineBarcode, status: 'active' });
  if (!machine) throw new ApiError(httpStatus.BAD_REQUEST, 'Table not found');
  const rack = await bundlesRack(rackCode);
  const bundles = await PieceBundle.find({ barcode: { $in: codes } });
  if (bundles.length !== codes.length) throw new ApiError(httpStatus.BAD_REQUEST, 'Bundle not found');
  for (const bundle of bundles) {
    if (bundle.process === 'thread-cut') throw new ApiError(httpStatus.BAD_REQUEST, 'This bundle is already thread cut');
    if (bundle.process !== 'horizontal-hem') throw new ApiError(httpStatus.BAD_REQUEST, 'This bundle is not hemmed');
    if (!bundle.closed || !bundle.barcode) throw new ApiError(httpStatus.BAD_REQUEST, 'This bundle is not hemmed');
    if (!bundle.rackCode && bundle.machineBarcode) throw new ApiError(httpStatus.BAD_REQUEST, 'This bundle is already on the table');
    if (!bundle.rackCode) throw new ApiError(httpStatus.BAD_REQUEST, 'This bundle is not on a rack');
    if (bundle.rackCode !== rack.code) throw new ApiError(httpStatus.BAD_REQUEST, 'This bundle is not on that rack');
  }
  return txnEntityUpdate({
    Model: PieceBundle,
    filter: { barcode: { $in: codes } },
    update: { rackCode: '', machineBarcode: machine.barcode },
    afterUpdate: (session) =>
      logBundles(bundles, { action: 'thread-cut-start', fromLocation: rack.code, toLocation: machine.barcode, remarks: '' }, user, session),
    load: (session) => PieceBundle.find({ barcode: { $in: codes } }).session(session || undefined),
  });
};

/**
 * Puts thread-cut bundles back on a bundles rack. The barcode and quantity stay.
 * @param {{ bundleBarcodes?: string[], rackCode?: string }} body
 * @param {object} [_params]
 * @param {object | null} [user]
 */
export const placeThreadCut = async (body, _params, user) => {
  const codes = bundleCodes(body.bundleBarcodes);
  const rackCode = String(body.rackCode || '').trim();
  if (!codes.length) throw new ApiError(httpStatus.BAD_REQUEST, 'Bundle barcodes are required');
  if (!rackCode) throw new ApiError(httpStatus.BAD_REQUEST, 'Rack is required');
  const rack = await bundlesRack(rackCode);
  const bundles = await PieceBundle.find({ barcode: { $in: codes } });
  if (bundles.length !== codes.length) throw new ApiError(httpStatus.BAD_REQUEST, 'Bundle not found');
  for (const bundle of bundles) {
    if (bundle.process === 'thread-cut') throw new ApiError(httpStatus.BAD_REQUEST, 'This bundle is already thread cut');
    if (bundle.process !== 'horizontal-hem' || bundle.rackCode || !bundle.machineBarcode) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'This bundle is not on the table');
    }
  }
  return txnEntityUpdate({
    Model: PieceBundle,
    filter: { barcode: { $in: codes } },
    update: { process: 'thread-cut', rackCode: rack.code },
    afterUpdate: (session) =>
      logBundles(bundles, { action: 'thread-cut-done', fromLocation: '', toLocation: rack.code, remarks: '' }, user, session),
    load: (session) => PieceBundle.find({ barcode: { $in: codes } }).session(session || undefined),
  });
};
