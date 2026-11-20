import httpStatus from 'http-status';
import ApiError from '../../utils/ApiError.js';
import { PieceBundle, ProductionOrder, ProductionOrderLog } from '../../models/production.model.js';
import Machine from '../../models/machine.model.js';
import { logBundles, rackOfType } from './bundleFloor.js';
import { txnEntityUpdate } from './floorTxn.js';
import { completedBundlesFromLogs } from './floorCompleted.js';

/**
 * Active bundles rack, matched by code or barcode.
 * @param {string} scanned
 */
const bundlesRack = (scanned) => rackOfType(scanned, 'bundles', 'This rack is not for bundles');

const INLINE_ELIGIBLE = new Set(['horizontal-hem', 'inline-check']);

/** User-facing label for bundle.process when past horizontal hemming. */
const STAGE_LABEL = {
  'thread-cut': 'thread cutting',
  'final-qc': 'final QC',
  'final-qc-defect': 'final QC (defect)',
  'in-container': 'move to ground',
  ironed: 'ironing',
  broken: 'route split',
  embroidery: 'embroidery',
  'embroidery-thread-cut': 'thread cutting after embroidery',
  sticker: 'sticker',
  'iron-after': 'ironing after route',
  created: 'before horizontal hemming',
};

/**
 * Inline checking applies only to hemmed bundles still at horizontal hem (not yet thread cut).
 * @param {{ process?: string }} bundle
 */
const assertInlineCheckEligible = (bundle) => {
  const process = bundle.process || 'created';
  if (INLINE_ELIGIBLE.has(process)) return;
  if (process === 'created') {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'This bundle has not finished horizontal hemming yet. Inline checking is only for hemmed bundles on a rack.'
    );
  }
  const stage = STAGE_LABEL[process] || process;
  throw new ApiError(
    httpStatus.BAD_REQUEST,
    `This bundle has already left horizontal hemming (now at ${stage}). Inline checking is not available — use a hemmed bundle that has not gone to thread cutting yet.`
  );
};

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
 * Board metrics and completed log rows only (operators scan bundles; no upcoming list).
 */
export const upcomingInlineCheck = async () => {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const doneToday = await ProductionOrderLog.countDocuments({ action: 'inline-check-done', at: { $gte: start } });
  const completed = await completedBundlesFromLogs(['inline-check-done']);
  return {
    results: [],
    active: [],
    completed,
    counts: { waiting: 0, doneToday, onRack: 0, completed: completed.length },
  };
};

/**
 * Load one hemmed bundle by barcode for inline checking (optional machine duplicate check).
 * @param {{ barcode?: string, hemMachineBarcode?: string }} query
 */
export const lookupInlineCheckBundle = async (query) => {
  const bundleBarcode = String(query.barcode || '').trim();
  const hemMachineBarcode = String(query.hemMachineBarcode || '').trim();
  if (!bundleBarcode) throw new ApiError(httpStatus.BAD_REQUEST, 'Bundle barcode is required');

  const bundle = await PieceBundle.findOne({ barcode: bundleBarcode }).lean();
  if (!bundle) throw new ApiError(httpStatus.BAD_REQUEST, 'Bundle not found');
  assertInlineCheckEligible(bundle);
  if (!bundle.closed) throw new ApiError(httpStatus.BAD_REQUEST, 'Bundle is not closed');
  if (!bundle.rackCode) throw new ApiError(httpStatus.BAD_REQUEST, 'This bundle is not on a rack');

  const orderNumbers = await orderNumbersFor([bundle]);
  const row = shapeBundle(bundle, orderNumbers);

  let alreadyLogged = false;
  if (hemMachineBarcode) {
    const machine = await Machine.findOne({
      status: 'active',
      barcode: hemMachineBarcode,
      $or: [{ machineType: 'horizontal-hemming' }, { floor: 'horizontal-hem', equipmentRole: 'machine' }],
    });
    if (!machine) throw new ApiError(httpStatus.BAD_REQUEST, 'Horizontal hemming machine not found');
    const remarks = `hemMachine=${machine.barcode}`;
    alreadyLogged = Boolean(
      await ProductionOrderLog.findOne({
        action: 'inline-check-done',
        entityType: 'bundle',
        entityCode: bundleBarcode,
        remarks,
      }).lean()
    );
  }

  return { bundle: row, alreadyLogged };
};

/**
 * Active horizontal-hemming machines for the inline-check console.
 */
export const listInlineCheckMachines = async () => {
  const byType = await Machine.find({ status: 'active', machineType: 'horizontal-hemming' })
    .sort({ name: 1 })
    .limit(200)
    .select('name code barcode machineType floor equipmentRole')
    .lean();
  if (byType.length) {
    return { results: byType.map((row) => ({ ...row, id: String(row._id || row.id) })) };
  }
  const fallback = await Machine.find({ status: 'active', floor: 'horizontal-hem', equipmentRole: 'machine' })
    .sort({ name: 1 })
    .limit(200)
    .select('name code barcode machineType floor equipmentRole')
    .lean();
  return { results: fallback.map((row) => ({ ...row, id: String(row._id || row.id) })) };
};

/**
 * Logs inline checking for one bundle against a horizontal-hemming machine; bundle stays hemmed.
 * @param {{ bundleBarcode?: string, hemMachineBarcode?: string, rackCode?: string, confirmed?: boolean }} body
 * @param {object} [_params]
 * @param {object | null} [user]
 */
export const recordInlineCheck = async (body, _params, user) => {
  const bundleBarcode = String(body.bundleBarcode || '').trim();
  const hemMachineBarcode = String(body.hemMachineBarcode || '').trim();
  const rackCode = String(body.rackCode || '').trim();
  if (!bundleBarcode) throw new ApiError(httpStatus.BAD_REQUEST, 'Bundle barcode is required');
  if (!hemMachineBarcode) throw new ApiError(httpStatus.BAD_REQUEST, 'Horizontal hemming machine is required');
  if (!rackCode) throw new ApiError(httpStatus.BAD_REQUEST, 'Rack is required');
  if (body.confirmed !== true) throw new ApiError(httpStatus.BAD_REQUEST, 'Confirm inline checking is done');

  const machine = await Machine.findOne({
    status: 'active',
    barcode: hemMachineBarcode,
    $or: [{ machineType: 'horizontal-hemming' }, { floor: 'horizontal-hem', equipmentRole: 'machine' }],
  });
  if (!machine) throw new ApiError(httpStatus.BAD_REQUEST, 'Horizontal hemming machine not found');

  const rack = await bundlesRack(rackCode);
  const bundles = await PieceBundle.find({ barcode: bundleBarcode });
  if (!bundles.length) throw new ApiError(httpStatus.BAD_REQUEST, 'Bundle not found');
  const bundle = bundles[0];

  assertInlineCheckEligible(bundle);
  if (!bundle.closed || !bundle.barcode) throw new ApiError(httpStatus.BAD_REQUEST, 'Bundle is not closed');
  if (!bundle.rackCode) throw new ApiError(httpStatus.BAD_REQUEST, 'This bundle is not on a rack');

  const remarks = `hemMachine=${machine.barcode}`;
  const alreadyLogged = await ProductionOrderLog.findOne({
    action: 'inline-check-done',
    entityType: 'bundle',
    entityCode: bundleBarcode,
    remarks,
  }).lean();
  if (alreadyLogged) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Inline checking is already logged for this bundle on this machine');
  }

  const priorRack = bundle.rackCode;
  return txnEntityUpdate({
    Model: PieceBundle,
    filter: { barcode: bundleBarcode },
    update: { process: 'horizontal-hem', rackCode: rack.code, machineBarcode: '' },
    afterUpdate: (session) =>
      logBundles(
        [bundle],
        { action: 'inline-check-done', fromLocation: priorRack, toLocation: rack.code, remarks },
        user,
        session
      ),
    load: (session) => PieceBundle.find({ barcode: bundleBarcode }).session(session || undefined),
  });
};