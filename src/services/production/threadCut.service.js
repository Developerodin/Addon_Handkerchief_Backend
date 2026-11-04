import httpStatus from 'http-status';
import ApiError from '../../utils/ApiError.js';
import { PieceBundle, ProductionOrder } from '../../models/production.model.js';
import Machine from '../../models/machine.model.js';
import StorageRack from '../../models/storageRack.model.js';
import { writeOrderLog } from '../orderLog.service.js';

/**
 * Active bundles rack, matched by code or barcode.
 * @param {string} scanned
 */
const bundlesRack = async (scanned) => {
  const rack = await StorageRack.findOne({
    status: 'active',
    $or: [{ code: String(scanned || '').toUpperCase() }, { barcode: scanned }, { barcode: String(scanned || '').toUpperCase() }],
  });
  if (!rack) throw new ApiError(httpStatus.BAD_REQUEST, 'Rack not found');
  if (rack.stockType !== 'bundles') throw new ApiError(httpStatus.BAD_REQUEST, 'This rack is not for bundles');
  return rack;
};

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
  const orders = await ProductionOrder.find({ _id: { $in: [...new Set(rows.map((row) => String(row.orderId)))] } }).select('orderNumber');
  return new Map(orders.map((order) => [String(order.id), order.orderNumber || '']));
};

/**
 * Hemmed bundles on a rack, plus bundles already on a thread-cutting table.
 */
export const upcomingThreadCut = async () => {
  const waitingQuery = { closed: true, process: 'horizontal-hem', rackCode: { $nin: ['', null] } };
  const activeQuery = { closed: true, process: 'horizontal-hem', rackCode: { $in: ['', null] }, machineBarcode: { $nin: ['', null] } };
  const [waiting, active] = await Promise.all([
    PieceBundle.find(waitingQuery).sort({ updatedAt: -1 }).limit(200),
    PieceBundle.find(activeQuery).sort({ updatedAt: -1 }).limit(200),
  ]);
  const orderNumbers = await orderNumbersFor([...waiting, ...active]);
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const [doneToday, onRack] = await Promise.all([
    PieceBundle.countDocuments({ process: 'thread-cut', updatedAt: { $gte: start } }),
    PieceBundle.countDocuments({ process: 'thread-cut', rackCode: { $nin: ['', null] } }),
  ]);
  return {
    results: waiting.map((row) => shapeBundle(row, orderNumbers)),
    active: active.map((row) => shapeBundle(row, orderNumbers)),
    counts: { waiting: waiting.length, onTable: active.length, doneToday, onRack },
  };
};

/**
 * One order log when every bundle belongs to that order.
 * @param {object[]} bundles
 * @param {object} entry
 * @param {object | null} user
 */
const logBundles = (bundles, entry, user) => {
  const orderIds = new Set(bundles.map((bundle) => String(bundle.orderId)));
  return writeOrderLog(
    {
      ...entry,
      orderId: orderIds.size === 1 ? bundles[0].orderId : undefined,
      entityType: 'bundle',
      entityCode: bundles[0].barcode,
      quantity: bundles.reduce((sum, bundle) => sum + (bundle.qty || 0), 0),
    },
    user
  );
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
  await PieceBundle.updateMany({ barcode: { $in: codes } }, { rackCode: '', machineBarcode: machine.barcode });
  await logBundles(bundles, { action: 'thread-cut-start', fromLocation: rack.code, toLocation: machine.barcode, remarks: '' }, user);
  return PieceBundle.find({ barcode: { $in: codes } });
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
  await PieceBundle.updateMany({ barcode: { $in: codes } }, { process: 'thread-cut', rackCode: rack.code });
  await logBundles(bundles, { action: 'thread-cut-done', fromLocation: '', toLocation: rack.code, remarks: '' }, user);
  return PieceBundle.find({ barcode: { $in: codes } });
};
