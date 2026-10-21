import httpStatus from 'http-status';
import ApiError from '../utils/ApiError.js';
import { DEFAULT_GRADES, QualityGrade, QualityResult } from '../models/quality.model.js';
import { FabricLot, FabricRoll, PurchaseOrder } from '../models/store.model.js';
import { PieceBundle } from '../models/production.model.js';
import { writeOrderLog } from './orderLog.service.js';
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
 * Rejects one scanned roll. The lot stays pending until pass, reject, or hold.
 * @param {{ poId?: string, barcode?: string, remarks?: string }} body
 */
export const rejectQcRoll = async (body) => {
  const barcode = String(body.barcode || '').trim();
  const roll = await FabricRoll.findOne({
    poId: body.poId,
    $or: [{ barcode }, { rollCode: barcode }],
  });
  if (!roll) throw new ApiError(httpStatus.NOT_FOUND, 'Roll not found on this order');
  if (CLOSED_ROLL.includes(roll.status)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'This roll can no longer be rejected');
  }
  roll.qcStatus = 'rejected';
  await roll.save();
  const eventId = `fabric-qc-roll:${roll.id}`;
  await QualityResult.findOneAndUpdate(
    { eventId },
    {
      eventId,
      kind: 'fabric-sample',
      lotId: roll.lotId,
      orderId: String(body.poId),
      receivedLotNumber: roll.receivedLotNumber,
      rollBarcode: roll.barcode,
      remarks: String(body.remarks || '').trim(),
      passed: false,
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
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
 * Good, defect, and M4 quantities must add up to the bundle. M4 is not in the good count.
 * @param {object} body
 * @param {object} [_params]
 * @param {object | null} [user]
 */
export const recordBundleCheck = async (body, _params, user) => {
  const bundle = await PieceBundle.findById(body.bundleId);
  if (!bundle) throw new ApiError(httpStatus.NOT_FOUND, 'Bundle not found');
  const sum = (body.goodQty || 0) + (body.defectQty || 0) + (body.m4Qty || 0);
  if (sum !== bundle.qty) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Bundle check quantities must sum to the bundle');
  }
  const existing = await QualityResult.findOne({ eventId: body.eventId });
  if (existing) return existing;
  bundle.checkedGood = body.goodQty === bundle.qty;
  await bundle.save();
  const result = await QualityResult.create({
    eventId: body.eventId,
    kind: 'bundle-check',
    bundleId: String(bundle.id),
    orderId: String(bundle.orderId),
    goodQty: body.goodQty,
    defectQty: body.defectQty,
    m4Qty: body.m4Qty,
    passed: bundle.checkedGood,
  });
  await writeOrderLog(
    {
      action: 'bundle-check',
      orderId: bundle.orderId,
      entityType: 'bundle',
      entityCode: String(bundle.id),
      quantity: body.goodQty || 0,
      remarks: `defect ${body.defectQty || 0} m4 ${body.m4Qty || 0}`,
    },
    user
  );
  return result;
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
