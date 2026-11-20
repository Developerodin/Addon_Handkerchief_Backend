import httpStatus from 'http-status';
import ApiError from '../utils/ApiError.js';
import { DEFAULT_GRADES, QualityGrade, QualityResult } from '../models/quality.model.js';
import { FabricLot, FabricRoll, PurchaseOrder } from '../models/store.model.js';
import { PieceBundle, ProductionOrder } from '../models/production.model.js';
import { actorOf, writeOrderLog } from './orderLog.service.js';
import { runTransaction, sessionOptions } from '../utils/mongoTransaction.js';
import { receiveRollBack } from './store.service.js';

/**
 * Inserts the factory grade list once.
 */
export const ensureGrades = async () => {
  for (const grade of DEFAULT_GRADES) {
    await QualityGrade.updateOne({ code: grade.code }, { $setOnInsert: grade }, { upsert: true });
  }
  return QualityGrade.find().sort({ code: 1 });
};

/**
 * Renames a grade. Stored results keep the code they were saved with.
 * @param {string} code
 * @param {string} name
 */
export const renameGrade = async (code, name) => {
  const grade = await QualityGrade.findOneAndUpdate({ code }, { name }, { new: true });
  if (!grade) throw new ApiError(httpStatus.NOT_FOUND, 'Grade not found');
  return grade;
};

/**
 * One failed sample holds the whole lot.
 * @param {{ eventId: string, lotId: string, rollBarcode: string, passed: boolean }} body
 */
export const recordFabricSample = async (body) => {
  const existing = await QualityResult.findOne({ eventId: body.eventId });
  if (existing) return existing;
  const lot = await FabricLot.findById(body.lotId);
  if (!lot) throw new ApiError(httpStatus.NOT_FOUND, 'Lot not found');
  const passed = body.passed === true || body.passed === 'true';
  const result = await QualityResult.create({ ...body, passed, kind: 'fabric-sample' });
  if (!passed) {
    lot.qcStatus = 'held';
    await lot.save();
    await FabricRoll.updateMany({ lotId: lot.id }, { status: 'lot-held' });
  }
  return result;
};

const CLOSED_ROLL = ['issued', 'on-floor', 'returned', 'returned-to-vendor'];

/**
 * Fabric-lot gate: held blocks the PO, passed once nothing is still pending and a lot passed.
 * @param {import('mongoose').Document} po
 */
async function syncFabricLot(po) {
  const fabricLot = await FabricLot.findOne({ poId: po.id }).sort({ createdAt: -1 });
  if (!fabricLot) return null;
  const active = (po.receivedLots || []).filter((row) => Number(row.rolls) > 0);
  const held = active.some((row) => row.qcStatus === 'held');
  const pending = active.some((row) => !row.qcStatus || row.qcStatus === 'pending');
  const anyPassed = active.some((row) => row.qcStatus === 'passed');
  fabricLot.qcStatus = held ? 'held' : !pending && anyPassed ? 'passed' : 'pending';
  await fabricLot.save();
  return fabricLot;
}

/**
 * Writes the latest lot decision. Location status on the roll is left alone.
 * @param {import('mongoose').Document} po
 * @param {string} lotNumber
 * @param {string} remarks
 * @param {boolean} passed
 * @param {import('mongoose').Document | null} fabricLot
 */
async function saveLotSample(po, lotNumber, remarks, passed, fabricLot) {
  const eventId = `fabric-qc:${po.id}:${lotNumber}`;
  const sample = {
    eventId,
    kind: 'fabric-sample',
    orderId: String(po.id),
    receivedLotNumber: lotNumber,
    remarks,
    passed,
  };
  if (fabricLot) sample.lotId = fabricLot.id;
  await QualityResult.findOneAndUpdate({ eventId }, sample, { upsert: true, new: true, setDefaultsOnInsert: true });
}

/**
 * Pass, reject, or hold one received lot. Pass approves every roll that was not already rejected.
 * @param {{ poId?: string, lotNumber?: string, action?: string, passed?: boolean | string, remarks?: string }} body
 * @param {object | null} [user]
 */
export const decideReceivedLot = async (body, user) => {
  const po = await PurchaseOrder.findById(body.poId);
  if (!po) throw new ApiError(httpStatus.NOT_FOUND, 'Purchase order not found');
  const lotNumber = String(body.lotNumber || '').trim();
  const lot = (po.receivedLots || []).find((row) => row.lotNumber === lotNumber);
  if (!lot) throw new ApiError(httpStatus.NOT_FOUND, 'Received lot not found');
  if (!(Number(lot.rolls) > 0)) throw new ApiError(httpStatus.BAD_REQUEST, 'This lot has no rolls to check');
  const action = body.action || (body.passed === false || body.passed === 'false' ? 'hold' : 'pass');
  if (!['pass', 'reject', 'hold'].includes(action)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'QC action must be pass, reject, or hold');
  }
  lot.qcStatus = action === 'pass' ? 'passed' : action === 'reject' ? 'rejected' : 'held';
  lot.qcBy = user?.name || user?.email || '';
  lot.qcAt = new Date();
  lot.qcRemarks = String(body.remarks || '').trim();
  po.markModified('receivedLots');
  await po.save();

  const open = { poId: po.id, receivedLotNumber: lotNumber, status: { $nin: CLOSED_ROLL } };
  if (action === 'pass') {
    await FabricRoll.updateMany({ ...open, qcStatus: { $ne: 'rejected' } }, { qcStatus: 'passed' });
  } else if (action === 'reject') {
    await FabricRoll.updateMany({ ...open, qcStatus: { $nin: ['passed', 'rejected'] } }, { qcStatus: 'rejected' });
  }
  const fabricLot = await syncFabricLot(po);
  await saveLotSample(po, lotNumber, lot.qcRemarks, action === 'pass', fabricLot);
  return po;
};

/**
 * One roll on this purchase order, matched by barcode or roll code.
 * @param {{ poId?: string, barcode?: string }} body
 */
async function findOrderRoll(body) {
  const barcode = String(body.barcode || '').trim();
  const roll = await FabricRoll.findOne({
    poId: body.poId,
    $or: [{ barcode }, { rollCode: barcode }],
  });
  if (!roll) throw new ApiError(httpStatus.NOT_FOUND, 'Roll not found on this order');
  return roll;
}

/**
 * Records the latest pass or reject for one roll. The received lot is left unchanged.
 * @param {import('mongoose').Document} roll
 * @param {string} poId
 * @param {string} remarks
 * @param {boolean} passed
 */
async function saveRollSample(roll, poId, remarks, passed) {
  const eventId = `fabric-qc-roll:${roll.id}`;
  await QualityResult.findOneAndUpdate(
    { eventId },
    {
      eventId,
      kind: 'fabric-sample',
      lotId: roll.lotId,
      orderId: String(poId),
      receivedLotNumber: roll.receivedLotNumber,
      rollBarcode: roll.barcode,
      remarks,
      passed,
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

/**
 * Passes one scanned roll. The lot stays pending until pass, reject, or hold.
 * @param {{ poId?: string, barcode?: string, remarks?: string }} body
 */
export const passQcRoll = async (body) => {
  const roll = await findOrderRoll(body);
  if (CLOSED_ROLL.includes(roll.status)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'This roll can no longer be passed');
  }
  if (roll.qcStatus === 'rejected') {
    throw new ApiError(httpStatus.BAD_REQUEST, 'A rejected roll cannot be passed');
  }
  if (roll.qcStatus !== 'passed') {
    roll.qcStatus = 'passed';
    await roll.save();
  }
  await saveRollSample(roll, body.poId, String(body.remarks || '').trim(), true);
  return roll;
};

/**
 * Rejects one scanned roll. The lot stays pending until pass, reject, or hold.
 * @param {{ poId?: string, barcode?: string, remarks?: string }} body
 */
export const rejectQcRoll = async (body) => {
  const roll = await findOrderRoll(body);
  if (CLOSED_ROLL.includes(roll.status)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'This roll can no longer be rejected');
  }
  roll.qcStatus = 'rejected';
  await roll.save();
  await saveRollSample(roll, body.poId, String(body.remarks || '').trim(), false);
  return roll;
};

/**
 * Purchase order plus the rolls created from Process, for the fabric QC screen.
 * @param {string} poId
 */
export const getFabricQcOrder = async (poId) => {
  const order = await PurchaseOrder.findById(poId);
  if (!order) throw new ApiError(httpStatus.NOT_FOUND, 'Purchase order not found');
  const rolls = await FabricRoll.find({ poId: order.id }).sort({ rollCode: 1 }).limit(500);
  return { order, rolls };
};

/**
 * All recorded samples passed, so the lot may be issued.
 * @param {string} lotId
 */
export const passLot = async (lotId) => {
  const lot = await FabricLot.findById(lotId);
  if (!lot) throw new ApiError(httpStatus.NOT_FOUND, 'Lot not found');
  const failed = await QualityResult.countDocuments({ lotId, kind: 'fabric-sample', passed: false });
  if (failed > 0) throw new ApiError(httpStatus.BAD_REQUEST, 'A failed sample holds the lot');
  const samples = await QualityResult.countDocuments({ lotId, kind: 'fabric-sample' });
  if (samples < 1) throw new ApiError(httpStatus.BAD_REQUEST, 'Sample the lot before passing it');
  lot.qcStatus = 'passed';
  await lot.save();
  return lot;
};

/**
 * A rejected roll goes back to a basement rack and leaves the cutting list.
 * @param {{ eventId: string, rollBarcode: string, rackCode: string }} body
 * @param {object} [_params]
 * @param {object | null} [user]
 */
export const rejectRollToRack = async (body, _params, user) => {
  const existing = await QualityResult.findOne({ eventId: body.eventId });
  if (existing) return existing;
  const result = await QualityResult.create({
    eventId: body.eventId,
    kind: 'initial-roll',
    rollBarcode: body.rollBarcode,
    passed: false,
    gradeCode: 'rejection',
  });
  await receiveRollBack({ rollBarcode: body.rollBarcode, rackCode: body.rackCode }, null, user);
  return result;
};

/**
 * @param {import('mongoose').Document} bundle
 */
const assertBundleReadyForFloorCheck = (bundle) => {
  if (!bundle) throw new ApiError(httpStatus.NOT_FOUND, 'Bundle not found');
  if (!bundle.closed) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Close this bundle on Single piece cutting before floor check.');
  }
  if (!bundle.barcode) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'This bundle has no barcode. Close it on Single piece cutting first.');
  }
  if (!String(bundle.rackCode || '').trim()) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Place this bundle on a bundles rack in Single piece cutting before floor check.'
    );
  }
};

/**
 * @param {import('mongoose').Document} bundle
 */
const articleLabelForBundle = async (bundle) => {
  const order = await ProductionOrder.findById(bundle.orderId).select('lines.articleName lines.fabricName').lean();
  if (!order?.lines?.length) return '';
  const lineId = bundle.lineId ? String(bundle.lineId) : '';
  const matched = lineId
    ? (order.lines || []).find((line) => String(line._id || line.id) === lineId)
    : order.lines[0];
  const line = matched || order.lines[0];
  return String(line?.articleName || line?.fabricName || '').trim();
};

/**
 * @param {object | null | undefined} user
 */
const actorLabel = (user) => actorOf(user).userName || actorOf(user).userId || '';

/**
 * @param {string} bundleId
 */
const openInspectionForBundle = async (bundleId) =>
  QualityResult.findOne({ bundleId: String(bundleId), kind: 'bundle-check', phase: 'inspected' }).sort({
    createdAt: -1,
  });

const passPayload = (bundle, result) => {
  const processOk = !bundle.process || bundle.process === 'created';
  return {
    ...result.toObject?.() ?? result,
    bundleBarcode: bundle.barcode,
    rackCode: bundle.rackCode,
    readyForHorizontalHem: processOk,
    nextStep: processOk ? 'horizontal-hem' : bundle.process,
  };
};

/**
 * Log M2/M4 at inspection; bundle stays on QC until pass.
 * @param {object} body
 * @param {object | null} [user]
 * @param {import('mongoose').ClientSession | null} [outerSession]
 */
const saveBundleInspection = async (body, user, outerSession = null) => {
  const bundle = await PieceBundle.findById(body.bundleId);
  assertBundleReadyForFloorCheck(bundle);
  if (bundle.floorChecked || bundle.checkedGood) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'This bundle has already passed floor check.');
  }
  const m2Qty =
    body.m2Qty !== undefined && body.m2Qty !== null
      ? Number(body.m2Qty) || 0
      : Number(body.defectQty) || 0;
  const m4Qty = Number(body.m4Qty) || 0;
  const arrivalQty = Number(bundle.qty) || 0;
  if (arrivalQty < 1) throw new ApiError(httpStatus.BAD_REQUEST, 'Bundle has no quantity.');
  if (m2Qty + m4Qty > arrivalQty) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'M2 + M4 cannot exceed arrival quantity');
  }
  const inspectionGoodQty = Math.max(0, arrivalQty - m2Qty - m4Qty);
  const existingEvent = body.eventId ? await QualityResult.findOne({ eventId: body.eventId }) : null;
  if (existingEvent) return { bundle, result: existingEvent, inspectionGoodQty, arrivalQty };

  const run = async (session) => {
    bundle.floorInspected = true;
    await bundle.save(sessionOptions(session));
    const articleLabel = await articleLabelForBundle(bundle);
    const lineId = bundle.lineId ? String(bundle.lineId) : '';
    const allGood = m2Qty === 0 && m4Qty === 0;
    let result = await openInspectionForBundle(bundle.id);
    if (result) {
      result.m2Qty = m2Qty;
      result.defectQty = m2Qty;
      result.m4Qty = m4Qty;
      result.arrivalQty = arrivalQty;
      result.inspectionGoodQty = inspectionGoodQty;
      result.articleLabel = articleLabel;
      result.lineId = lineId;
      result.inspectedBy = actorLabel(user);
      result.passed = allGood;
      await result.save(sessionOptions(session));
    } else {
      const eventId = body.eventId || `bdl-insp-${bundle.id}-${Date.now()}`;
      [result] = await QualityResult.create(
        [
          {
            eventId,
            kind: 'bundle-check',
            phase: 'inspected',
            bundleId: String(bundle.id),
            orderId: String(bundle.orderId),
            m2Qty,
            defectQty: m2Qty,
            m4Qty,
            arrivalQty,
            inspectionGoodQty,
            articleLabel,
            lineId,
            inspectedBy: actorLabel(user),
            passed: allGood,
            rackCode: bundle.rackCode || '',
          },
        ],
        sessionOptions(session)
      );
    }
    await writeOrderLog(
      {
        action: 'bundle-check-inspect',
        orderId: bundle.orderId,
        entityType: 'bundle',
        entityCode: bundle.barcode,
        quantity: inspectionGoodQty,
        remarks: `m2 ${m2Qty} m4 ${m4Qty} arrival ${arrivalQty}`,
      },
      user,
      session
    );
    return result;
  };

  const result = outerSession ? await run(outerSession) : await runTransaction(run);
  return { bundle, result, inspectionGoodQty, arrivalQty };
};

/**
 * @param {object} body
 * @param {object | null} [user]
 * @param {import('mongoose').ClientSession | null} [outerSession]
 */
const saveBundlePass = async (body, user, outerSession = null) => {
  const bundle = await PieceBundle.findById(body.bundleId);
  assertBundleReadyForFloorCheck(bundle);
  if (!bundle.floorInspected) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Save inspection (M2/M4) before passing to the next floor.');
  }
  if (bundle.floorChecked || bundle.checkedGood) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'This bundle has already passed floor check.');
  }
  const inspection = await openInspectionForBundle(bundle.id);
  if (!inspection) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'No inspection record found for this bundle.');
  }
  const goodAddedQty = Number(body.goodAddedQty) || 0;
  const passGoodQty = Number(body.passGoodQty);
  const inspectionGoodQty = Number(inspection.inspectionGoodQty) || 0;
  const maxPass = inspectionGoodQty + goodAddedQty;
  if (!Number.isFinite(passGoodQty) || passGoodQty < 1) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Pass quantity must be at least 1');
  }
  if (passGoodQty > maxPass) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Pass quantity cannot exceed good after inspection (${inspectionGoodQty}) plus good added (${goodAddedQty})`
    );
  }
  const existingEvent = body.eventId ? await QualityResult.findOne({ eventId: body.eventId }) : null;
  if (existingEvent?.phase === 'passed') return passPayload(bundle, existingEvent);

  const m2Qty = Number(inspection.m2Qty) || 0;
  const m4Qty = Number(inspection.m4Qty) || 0;
  const allGood = m2Qty === 0 && m4Qty === 0 && goodAddedQty === 0 && passGoodQty === Number(inspection.arrivalQty || bundle.qty);

  const run = async (session) => {
    bundle.floorChecked = true;
    bundle.checkedGood = true;
    bundle.finalGood = passGoodQty;
    bundle.qty = passGoodQty;
    await bundle.save(sessionOptions(session));
    inspection.phase = 'passed';
    inspection.goodAddedQty = goodAddedQty;
    inspection.passGoodQty = passGoodQty;
    inspection.goodQty = passGoodQty;
    inspection.passedBy = actorLabel(user);
    inspection.passed = allGood;
    await inspection.save(sessionOptions(session));
    await writeOrderLog(
      {
        action: 'bundle-check',
        orderId: bundle.orderId,
        entityType: 'bundle',
        entityCode: bundle.barcode,
        quantity: passGoodQty,
        remarks: `added ${goodAddedQty} m2 ${m2Qty} m4 ${m4Qty}`,
      },
      user,
      session
    );
    return inspection;
  };

  const result = outerSession ? await run(outerSession) : await runTransaction(run);
  return passPayload(bundle, result);
};

export const recordBundleInspect = async (body, _params, user) => {
  const { bundle, result, inspectionGoodQty, arrivalQty } = await saveBundleInspection(body, user);
  return {
    ...result.toObject(),
    inspectionGoodQty,
    arrivalQty,
    bundleBarcode: bundle?.barcode,
  };
};

export const recordBundlePass = async (body, _params, user) => saveBundlePass(body, user);

/**
 * One-shot floor check (legacy clients). Runs inspect + pass with goodAdded 0.
 * @deprecated Prefer `/quality/bundle-checks/inspect` and `/quality/bundle-checks/pass`.
 */
export const recordBundleCheck = async (body, _params, user) => {
  const existing = body.eventId ? await QualityResult.findOne({ eventId: body.eventId }) : null;
  if (existing) {
    const bundle = await PieceBundle.findById(body.bundleId || existing.bundleId);
    return passPayload(bundle, existing);
  }
  if (body.passGoodQty != null || body.goodAddedQty != null) {
    await saveBundleInspection(body, user);
    return saveBundlePass(
      {
        bundleId: body.bundleId,
        goodAddedQty: body.goodAddedQty ?? 0,
        passGoodQty: body.passGoodQty ?? body.goodQty,
        eventId: body.passEventId || body.eventId,
      },
      user
    );
  }
  const bundle = await PieceBundle.findById(body.bundleId);
  assertBundleReadyForFloorCheck(bundle);
  const m2Qty =
    body.m2Qty !== undefined && body.m2Qty !== null
      ? Number(body.m2Qty) || 0
      : Number(body.defectQty) || 0;
  const goodQty = Number(body.goodQty) || 0;
  const m4Qty = Number(body.m4Qty) || 0;
  const sum = goodQty + m2Qty + m4Qty;
  if (sum !== bundle.qty) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Good + M2 + M4 must equal the bundle quantity');
  }
  return runTransaction(async (session) => {
    await saveBundleInspection(
      { ...body, eventId: body.inspectEventId || `bdl-insp-${body.bundleId}-${Date.now()}` },
      user,
      session
    );
    return saveBundlePass(
      {
        bundleId: body.bundleId,
        goodAddedQty: 0,
        passGoodQty: goodQty,
        eventId: body.eventId || `bdl-pass-${body.bundleId}-${Date.now()}`,
      },
      user,
      session
    );
  });
};

/**
 * Paginated floor defect / bundle-check ledger for supervisors.
 * @param {object} query
 */
const QC_LOG_KINDS = new Set(['bundle-check', 'final-qc', 'final-checking', 'all']);

export const listFloorDefectLogs = async (query) => {
  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);
  const page = Math.max(Number(query.page) || 1, 1);
  const kindParam = String(query.kind || 'bundle-check').trim();
  const filter = {};
  if (kindParam === 'all') {
    filter.kind = { $in: ['bundle-check', 'final-qc', 'final-checking'] };
  } else if (QC_LOG_KINDS.has(kindParam)) {
    filter.kind = kindParam;
  } else {
    filter.kind = 'bundle-check';
  }
  if (query.orderId) filter.orderId = String(query.orderId);
  if (query.bundleId) filter.bundleId = String(query.bundleId);
  if (query.phase === 'inspected' || query.phase === 'passed') filter.phase = query.phase;
  if (query.barcode) {
    const bundle = await PieceBundle.findOne({ barcode: String(query.barcode).trim() });
    if (!bundle) return { results: [], page, limit, total: 0 };
    filter.bundleId = String(bundle._id || bundle.id);
  }
  const logFields =
    'kind bundleId orderId phase arrivalQty m2Qty m4Qty defectQty inspectionGoodQty goodAddedQty passGoodQty grades articleLabel inspectedBy passedBy createdAt updatedAt';
  const [rows, total] = await Promise.all([
    QualityResult.find(filter)
      .select(logFields)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    QualityResult.countDocuments(filter),
  ]);
  const bundleIds = [...new Set(rows.map((row) => row.bundleId).filter(Boolean))];
  const bundles = bundleIds.length ? await PieceBundle.find({ _id: { $in: bundleIds } }).select('barcode rackCode').lean() : [];
  const barcodeById = new Map(bundles.map((row) => [String(row._id), row.barcode || '']));
  const orderIds = [...new Set(rows.map((row) => row.orderId).filter(Boolean))];
  const orders = orderIds.length
    ? await ProductionOrder.find({ _id: { $in: orderIds } }).select('orderNumber').lean()
    : [];
  const orderNumberById = new Map(orders.map((row) => [String(row._id), row.orderNumber || '']));
  const results = rows.map((row) => {
    const grades = (row.grades || []).filter((grade) => Number(grade.qty) > 0);
    return {
      ...row,
      bundleBarcode: barcodeById.get(String(row.bundleId)) || '',
      orderNumber: orderNumberById.get(String(row.orderId)) || '',
      defectGrades: grades.length ? grades : undefined,
    };
  });
  return { results, page, limit, total };
};

/**
 * Final good quantity is what packing is allowed to take.
 * @param {object} body
 */
export const recordFinalCheck = async (body) => {
  const existing = await QualityResult.findOne({ eventId: body.eventId });
  if (existing) return existing;
  return QualityResult.create({ ...body, kind: 'final' });
};

/**
 * @param {string} orderId
 */
export const finalGoodQty = async (orderId) => {
  const rows = await QualityResult.find({ orderId: String(orderId), kind: 'final' });
  return rows.reduce((sum, row) => sum + (row.goodQty || 0), 0);
};
