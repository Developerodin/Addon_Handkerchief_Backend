import httpStatus from 'http-status';
import ApiError from '../../utils/ApiError.js';
import { PieceBundle, ProductionOrder } from '../../models/production.model.js';
import { QualityResult } from '../../models/quality.model.js';
import { runTransaction, sessionOptions } from '../../utils/mongoTransaction.js';
import { logBundles } from './bundleFloor.js';
import { completedBundlesFromLogs } from './floorCompleted.js';
import {
  gradesFromBody,
  latestQcMetaByBundleIds,
  saveGradeInspection,
  saveGradePass,
} from './qcInspectPass.js';

const KIND = 'final-qc';
const INSPECT_ACTION = 'final-qc-inspect';
const PASS_ACTION = 'final-qc';

const WAITING_ON_RACK = {
  closed: true,
  process: 'thread-cut',
  rackCode: { $nin: ['', null] },
};

const QUEUE_FIELDS =
  'barcode orderId qty rackCode finalQcInspected process closed finalGood updatedAt';

/**
 * @param {import('mongoose').LeanDocument | import('mongoose').Document} row
 * @param {Map<string, object>} numbers
 * @param {Map<string, object>} metaById
 */
function mapQueueRow(row, numbers, metaById) {
  const id = String(row._id || row.id);
  const meta = metaById.get(id);
  const arrivalQty = Number(meta?.arrivalQty) || Number(row.qty) || 0;
  const inspectionGoodQty = Number(meta?.inspectionGoodQty) || 0;
  return {
    id,
    barcode: row.barcode,
    orderId: String(row.orderId),
    orderNumber: numbers.get(String(row.orderId)) || '',
    qty: arrivalQty,
    arrivalQty,
    rackCode: row.rackCode || '',
    finalQcInspected: Boolean(row.finalQcInspected),
    inspectionGoodQty,
    defectQty: Number(meta?.defectQty) || 0,
    articleLabel: meta?.articleLabel || '',
  };
}

/**
 * @param {object} body
 */
async function bundleFromBody(body) {
  const barcode = String(body.bundleBarcode || '').trim();
  if (barcode) {
    const bundle = await PieceBundle.findOne({ barcode });
    if (!bundle) throw new ApiError(httpStatus.BAD_REQUEST, 'Bundle not found');
    return bundle;
  }
  const bundleId = body.bundleId;
  if (!bundleId) throw new ApiError(httpStatus.BAD_REQUEST, 'Bundle barcode is required');
  const bundle = await PieceBundle.findById(bundleId);
  if (!bundle) throw new ApiError(httpStatus.BAD_REQUEST, 'Bundle not found');
  return bundle;
}

/**
 * @param {import('mongoose').Document} bundle
 */
function assertWaitingForFinalQc(bundle) {
  if (bundle.process !== 'thread-cut' || !bundle.closed || !bundle.rackCode) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'This bundle is not waiting for final QC');
  }
}

/**
 * Thread-cut bundles on rack: inspect now and awaiting pass.
 */
export const upcomingFinalQc = async () => {
  const [inspectRows, awaitingRows, completed] = await Promise.all([
    PieceBundle.find({ ...WAITING_ON_RACK, finalQcInspected: { $ne: true } })
      .select(QUEUE_FIELDS)
      .sort({ updatedAt: -1 })
      .limit(200)
      .lean(),
    PieceBundle.find({ ...WAITING_ON_RACK, finalQcInspected: true })
      .select(QUEUE_FIELDS)
      .sort({ updatedAt: -1 })
      .limit(200)
      .lean(),
    completedBundlesFromLogs([PASS_ACTION]),
  ]);

  const allRows = [...inspectRows, ...awaitingRows];
  const orderIds = [...new Set(allRows.map((row) => row.orderId))];
  const bundleIds = allRows.map((row) => String(row._id));

  const [orders, metaById] = await Promise.all([
    orderIds.length
      ? ProductionOrder.find({ _id: { $in: orderIds } }).select('orderNumber').lean()
      : Promise.resolve([]),
    latestQcMetaByBundleIds(KIND, bundleIds),
  ]);
  const numbers = new Map(orders.map((order) => [String(order._id), order.orderNumber || '']));

  const inspectNow = inspectRows.map((row) => mapQueueRow(row, numbers, metaById));
  const awaitingPass = awaitingRows.map((row) => mapQueueRow(row, numbers, metaById));

  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const [doneToday, onRack] = await Promise.all([
    QualityResult.countDocuments({ kind: KIND, phase: 'passed', updatedAt: { $gte: start } }),
    PieceBundle.countDocuments({ process: 'final-qc', finalGood: { $gt: 0 }, rackCode: { $nin: ['', null] } }),
  ]);

  return {
    results: inspectNow,
    awaitingPass,
    received: awaitingPass,
    completed,
    counts: {
      waiting: inspectNow.length,
      inspectNow: inspectNow.length,
      awaitingPass: awaitingPass.length,
      received: awaitingPass.length,
      doneToday,
      onRack,
      completed: completed.length,
    },
  };
};

/**
 * @param {import('mongoose').Document} bundle
 * @param {number} passGoodQty
 * @param {object} body
 * @param {import('mongoose').ClientSession} session
 */
async function applyFinalQcPass(bundle, passGoodQty, user, session) {
  if (passGoodQty > 0) {
    bundle.process = 'final-qc';
    bundle.finalGood = passGoodQty;
    if (passGoodQty !== bundle.qty) bundle.qty = passGoodQty;
  } else {
    bundle.process = 'final-qc-defect';
    bundle.finalGood = 0;
  }
  await bundle.save(sessionOptions(session));
  const remarks = passGoodQty > 0 ? `good ${passGoodQty}` : 'all defect';
  await logBundles(
    [bundle],
    { action: PASS_ACTION, fromLocation: bundle.rackCode, toLocation: bundle.rackCode, remarks },
    user,
    session
  );
}

/**
 * @param {object} body
 * @param {object} [_params]
 * @param {object | null} [user]
 */
export const recordFinalQcInspect = async (body, _params, user) => {
  const bundle = await bundleFromBody(body);
  assertWaitingForFinalQc(bundle);
  const arrivalQty = Number(bundle.qty) || 0;
  const result = await runTransaction(async (session) => {
    const inspection = await saveGradeInspection({
      kind: KIND,
      bundle,
      body,
      user,
      session,
      arrivalQty,
      inspectAction: INSPECT_ACTION,
      inspectedFlag: 'finalQcInspected',
    });
    return inspection;
  });
  return {
    ...result.toObject(),
    inspectionGoodQty: result.inspectionGoodQty,
    arrivalQty: result.arrivalQty,
    bundleBarcode: bundle.barcode,
    bundleId: String(bundle.id),
  };
};

/**
 * @param {object} body
 * @param {object} [_params]
 * @param {object | null} [user]
 */
export const recordFinalQcPass = async (body, _params, user) => {
  const bundle = await bundleFromBody(body);
  assertWaitingForFinalQc(bundle);
  return runTransaction(async (session) => {
    await saveGradePass({
      kind: KIND,
      bundle,
      body,
      user,
      session,
      inspectedFlag: 'finalQcInspected',
      passAction: PASS_ACTION,
      applyPass: async (b, passGoodQty, _passBody, sess) => applyFinalQcPass(b, passGoodQty, user, sess),
    });
    return bundle;
  });
};

/**
 * Legacy one-shot: inspect + pass with goodAdded 0.
 * @param {object} body
 * @param {object} [_params]
 * @param {object | null} [user]
 */
export const recordFinalQc = async (body, _params, user) => {
  const bundle = await bundleFromBody(body);
  assertWaitingForFinalQc(bundle);
  const existing = await QualityResult.findOne({ kind: KIND, bundleId: String(bundle.id), phase: 'passed' });
  if (existing) throw new ApiError(httpStatus.BAD_REQUEST, 'This bundle is already final checked');
  const legacyRow = await QualityResult.findOne({ kind: KIND, bundleId: String(bundle.id), phase: { $exists: false } });
  if (legacyRow) throw new ApiError(httpStatus.BAD_REQUEST, 'This bundle is already final checked');

  const arrivalQty = Number(bundle.qty) || 0;
  const { defectSum } = gradesFromBody(body);
  if (defectSum > arrivalQty) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Defect counts cannot exceed the bundle quantity');
  }
  const passGoodQty = Math.max(0, arrivalQty - defectSum);

  return runTransaction(async (session) => {
    await saveGradeInspection({
      kind: KIND,
      bundle,
      body,
      user,
      session,
      arrivalQty,
      inspectAction: INSPECT_ACTION,
      inspectedFlag: 'finalQcInspected',
    });
    await saveGradePass({
      kind: KIND,
      bundle,
      body: { ...body, goodAddedQty: 0, passGoodQty },
      user,
      session,
      inspectedFlag: 'finalQcInspected',
      passAction: PASS_ACTION,
      applyPass: async (b, qty, _passBody, sess) => applyFinalQcPass(b, qty, user, sess),
    });
    return bundle;
  });
};