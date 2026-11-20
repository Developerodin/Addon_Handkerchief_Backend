import httpStatus from 'http-status';
import ApiError from '../../utils/ApiError.js';
import { PieceBundle, ProductionOrder } from '../../models/production.model.js';
import { QualityResult } from '../../models/quality.model.js';
import { runTransaction, sessionOptions } from '../../utils/mongoTransaction.js';
import { logBundles, rackOfType } from './bundleFloor.js';
import { completedBundlesFromLogs } from './floorCompleted.js';
import { syncOrderFromFinalChecking } from './orderProgress.js';
import {
  FINAL_QC_GRADES,
  gradesFromBody,
  latestQcMetaByBundleIds,
  saveGradeInspection,
  passedBundleIds,
  saveGradePass,
  whole,
} from './qcInspectPass.js';

const KIND = 'final-checking';
const INSPECT_ACTION = 'final-checking-inspect';
const PASS_ACTION = 'final-checking';

const ELIGIBLE = {
  closed: true,
  rackCode: { $nin: ['', null] },
  $or: [
    { process: 'broken', route: 'normal' },
    { process: 'iron-after' },
  ],
};

const QUEUE_FIELDS =
  'barcode orderId qty finalGood rackCode finalCheckingInspected process route closed updatedAt';

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
function assertReadyForFinalChecking(bundle) {
  const normal = bundle.process === 'broken' && bundle.route === 'normal';
  const after = bundle.process === 'iron-after';
  if ((!normal && !after) || !bundle.rackCode) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'This bundle is not ready for final checking');
  }
}

/**
 * @param {import('mongoose').LeanDocument} row
 * @param {Map<string, string>} numbers
 * @param {Map<string, object>} metaById
 */
function mapQueueRow(row, numbers, metaById) {
  const id = String(row._id);
  const meta = metaById.get(id);
  const arrivalQty = Number(meta?.arrivalQty) || Number(row.finalGood) || 0;
  return {
    id,
    barcode: row.barcode,
    orderId: String(row.orderId),
    orderNumber: numbers.get(String(row.orderId)) || '',
    qty: arrivalQty,
    arrivalQty,
    finalGood: Number(row.finalGood) || arrivalQty,
    rackCode: row.rackCode || '',
    finalCheckingInspected: Boolean(row.finalCheckingInspected),
    inspectionGoodQty: Number(meta?.inspectionGoodQty) || 0,
    defectQty: Number(meta?.defectQty) || 0,
  };
}

export const upcomingFinalChecking = async () => {
  const [passedIds, inspectRaw, awaitingRaw, completed] = await Promise.all([
    passedBundleIds(KIND),
    PieceBundle.find({ ...ELIGIBLE, finalCheckingInspected: { $ne: true } })
      .select(QUEUE_FIELDS)
      .sort({ updatedAt: -1 })
      .limit(200)
      .lean(),
    PieceBundle.find({ ...ELIGIBLE, finalCheckingInspected: true })
      .select(QUEUE_FIELDS)
      .sort({ updatedAt: -1 })
      .limit(200)
      .lean(),
    completedBundlesFromLogs([PASS_ACTION]),
  ]);
  const inspectRows = inspectRaw.filter((row) => !passedIds.has(String(row._id)));
  const awaitingRows = awaitingRaw.filter((row) => !passedIds.has(String(row._id)));

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
  const doneToday = await QualityResult.countDocuments({ kind: KIND, phase: 'passed', createdAt: { $gte: start } });

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
      onRack: inspectNow.length + awaitingPass.length,
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
async function applyFinalCheckingPass(bundle, passGoodQty, body, user, session) {
  let rackCode = '';
  if (passGoodQty > 0) {
    const rack = await rackOfType(body.rackCode, 'packing', 'This rack is not for packing');
    rackCode = rack.code;
  }
  bundle.finalGood = passGoodQty;
  bundle.rackCode = rackCode;
  await bundle.save(sessionOptions(session));
  await QualityResult.updateOne(
    { kind: KIND, bundleId: String(bundle.id), phase: 'passed' },
    { $set: { rackCode } },
    sessionOptions(session)
  );
  const defect = Number(body._defectQty) || 0;
  await logBundles(
    [bundle],
    { action: PASS_ACTION, fromLocation: '', toLocation: rackCode, remarks: `defect ${defect}` },
    user,
    session
  );
}

/**
 * @param {object} body
 * @param {object} [_params]
 * @param {object | null} [user]
 */
export const recordFinalCheckingInspect = async (body, _params, user) => {
  const bundle = await bundleFromBody(body);
  assertReadyForFinalChecking(bundle);
  const arrivalQty = Number(bundle.finalGood) || 0;
  if (arrivalQty < 1) throw new ApiError(httpStatus.BAD_REQUEST, 'Bundle has no good quantity for final checking');
  const result = await runTransaction(async (session) =>
    saveGradeInspection({
      kind: KIND,
      bundle,
      body,
      user,
      session,
      arrivalQty,
      inspectAction: INSPECT_ACTION,
      inspectedFlag: 'finalCheckingInspected',
    })
  );
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
export const recordFinalCheckingPass = async (body, _params, user) => {
  const bundle = await bundleFromBody(body);
  assertReadyForFinalChecking(bundle);
  const open = await QualityResult.findOne({
    kind: KIND,
    bundleId: String(bundle.id),
    phase: 'inspected',
  }).sort({ createdAt: -1 });
  body._defectQty = open?.defectQty || 0;
  const saved = await runTransaction(async (session) => {
    await saveGradePass({
      kind: KIND,
      bundle,
      body,
      user,
      session,
      inspectedFlag: 'finalCheckingInspected',
      passAction: PASS_ACTION,
      applyPass: async (b, passGoodQty, passBody, sess) => {
        if (passGoodQty > 0 && !passBody.rackCode) {
          throw new ApiError(httpStatus.BAD_REQUEST, 'Packing rack is required when passing good quantity');
        }
        return applyFinalCheckingPass(b, passGoodQty, passBody, user, sess);
      },
    });
    return bundle;
  });
  await syncOrderFromFinalChecking(saved.orderId, user);
  return saved;
};

/**
 * Legacy one-shot or grade-based one-shot.
 * @param {object} body
 * @param {object} [_params]
 * @param {object | null} [user]
 */
export const recordFinalChecking = async (body, _params, user) => {
  const bundle = await bundleFromBody(body);
  assertReadyForFinalChecking(bundle);
  const existing = await QualityResult.findOne({ kind: KIND, bundleId: String(bundle.id), phase: 'passed' });
  if (existing) throw new ApiError(httpStatus.BAD_REQUEST, 'This bundle is already final checked');
  const legacyRow = await QualityResult.findOne({ kind: KIND, bundleId: String(bundle.id), phase: { $exists: false } });
  if (legacyRow) throw new ApiError(httpStatus.BAD_REQUEST, 'This bundle is already final checked');

  const hasLegacyGood = body.good !== undefined && body.good !== null && body.good !== '';
  const hasGradeInput = FINAL_QC_GRADES.some((code) => body[code] !== undefined && body[code] !== null && body[code] !== '');

  if (hasLegacyGood && !hasGradeInput) {
    const good = whole(body.good, 'Good');
    const defect = whole(body.defect, 'Defect');
    if (good + defect !== bundle.finalGood) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Final checking counts must sum to the good count');
    }
    const inspectBody = { ...body, rejection: defect };
    for (const code of FINAL_QC_GRADES) {
      if (code !== 'rejection') inspectBody[code] = 0;
    }
    return runTransaction(async (session) => {
      body._defectQty = defect;
      await saveGradeInspection({
        kind: KIND,
        bundle,
        body: inspectBody,
        user,
        session,
        arrivalQty: Number(bundle.finalGood) || 0,
        inspectAction: INSPECT_ACTION,
        inspectedFlag: 'finalCheckingInspected',
      });
      await saveGradePass({
        kind: KIND,
        bundle,
        body: { ...body, goodAddedQty: 0, passGoodQty: good },
        user,
        session,
        inspectedFlag: 'finalCheckingInspected',
        passAction: PASS_ACTION,
        applyPass: async (b, passGoodQty, passBody, sess) => {
          if (passGoodQty > 0 && !passBody.rackCode) {
            throw new ApiError(httpStatus.BAD_REQUEST, 'Packing rack is required when passing good quantity');
          }
          return applyFinalCheckingPass(b, passGoodQty, passBody, user, sess);
        },
      });
      return bundle;
    }).then(async (saved) => {
      await syncOrderFromFinalChecking(saved.orderId, user);
      return saved;
    });
  }

  const arrivalQty = Number(bundle.finalGood) || 0;
  const { defectSum } = gradesFromBody(body);
  if (defectSum > arrivalQty) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Defect counts cannot exceed the bundle good quantity');
  }
  const passGoodQty = Math.max(0, arrivalQty - defectSum);
  if (passGoodQty > 0 && !body.rackCode) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Packing rack is required when passing good quantity');
  }

  return runTransaction(async (session) => {
    body._defectQty = defectSum;
    await saveGradeInspection({
      kind: KIND,
      bundle,
      body,
      user,
      session,
      arrivalQty,
      inspectAction: INSPECT_ACTION,
      inspectedFlag: 'finalCheckingInspected',
    });
    await saveGradePass({
      kind: KIND,
      bundle,
      body: { ...body, goodAddedQty: 0, passGoodQty },
      user,
      session,
      inspectedFlag: 'finalCheckingInspected',
      passAction: PASS_ACTION,
      applyPass: async (b, qty, passBody, sess) => applyFinalCheckingPass(b, qty, passBody, user, sess),
    });
    return bundle;
  }).then(async (saved) => {
    await syncOrderFromFinalChecking(saved.orderId, user);
    return saved;
  });
};