import httpStatus from 'http-status';
import ApiError from '../../utils/ApiError.js';
import { QualityResult } from '../../models/quality.model.js';
import { ProductionOrder } from '../../models/production.model.js';
import { actorOf, writeOrderLog } from '../orderLog.service.js';
import { sessionOptions } from '../../utils/mongoTransaction.js';

export const FINAL_QC_GRADES = ['long', 'hemming', 'sporting', 'diving', 'rejection'];

/**
 * @param {unknown} value
 * @param {string} label
 */
export const whole = (value, label) => {
  const count = value == null || value === '' ? 0 : Number(value);
  if (!Number.isInteger(count) || count < 0) throw new ApiError(httpStatus.BAD_REQUEST, `${label} count is invalid`);
  return count;
};

/**
 * @param {object} body
 */
export const gradesFromBody = (body) => {
  const grades = [];
  let defectSum = 0;
  for (const code of FINAL_QC_GRADES) {
    const qty = whole(body[code], code);
    if (!qty) continue;
    grades.push({ code, qty, rackCode: '' });
    defectSum += qty;
  }
  return { grades, defectSum };
};

/**
 * @param {import('mongoose').Document} bundle
 */
export const articleLabelForBundle = async (bundle) => {
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
 * @param {string} kind
 * @param {string} bundleId
 */
export const openInspectionForBundle = async (kind, bundleId) =>
  QualityResult.findOne({ kind, bundleId: String(bundleId), phase: 'inspected' }).sort({ createdAt: -1 });

/**
 * @param {string} kind
 * @param {string[]} bundleIds
 */
export const latestQcMetaByBundleIds = async (kind, bundleIds) => {
  if (!bundleIds.length) return new Map();
  const rows = await QualityResult.aggregate([
    { $match: { kind, bundleId: { $in: bundleIds.map(String) } } },
    { $sort: { createdAt: -1 } },
    {
      $group: {
        _id: '$bundleId',
        phase: { $first: '$phase' },
        inspectionGoodQty: { $first: '$inspectionGoodQty' },
        arrivalQty: { $first: '$arrivalQty' },
        defectQty: { $first: '$defectQty' },
        grades: { $first: '$grades' },
      },
    },
  ]);
  return new Map(rows.map((row) => [String(row._id), row]));
};

/**
 * Bundle ids with a passed QC result (including legacy rows without phase).
 * @param {string} kind
 */
export const passedBundleIds = async (kind) => {
  const rows = await QualityResult.find({ kind }).select('bundleId phase createdAt').sort({ createdAt: -1 }).lean();
  const passed = new Set();
  const seen = new Set();
  for (const row of rows) {
    const id = String(row.bundleId);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    if (row.phase === 'passed' || !row.phase) passed.add(id);
  }
  return passed;
};

/**
 * @param {object | null | undefined} user
 */
const actorLabel = (user) => actorOf(user).userName || actorOf(user).userId || '';

/**
 * @param {object} params
 */
export const saveGradeInspection = async ({
  kind,
  bundle,
  body,
  user,
  session,
  arrivalQty,
  inspectAction,
  inspectedFlag,
}) => {
  if (bundle[inspectedFlag]) {
    const existingPass = await QualityResult.findOne({
      kind,
      bundleId: String(bundle.id),
      phase: 'passed',
    });
    if (existingPass) throw new ApiError(httpStatus.BAD_REQUEST, 'This bundle has already passed QC');
  }
  const { grades, defectSum } = gradesFromBody(body);
  if (defectSum > arrivalQty) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Defect counts cannot exceed the bundle quantity');
  }
  const inspectionGoodQty = Math.max(0, arrivalQty - defectSum);
  const existingEvent = body.eventId ? await QualityResult.findOne({ eventId: body.eventId }) : null;
  if (existingEvent) return existingEvent;

  bundle[inspectedFlag] = true;
  await bundle.save(sessionOptions(session));

  const articleLabel = await articleLabelForBundle(bundle);
  const lineId = bundle.lineId ? String(bundle.lineId) : '';
  let result = await openInspectionForBundle(kind, bundle.id);
  if (result) {
    result.grades = grades;
    result.defectQty = defectSum;
    result.arrivalQty = arrivalQty;
    result.inspectionGoodQty = inspectionGoodQty;
    result.goodQty = 0;
    result.articleLabel = articleLabel;
    result.lineId = lineId;
    result.inspectedBy = actorLabel(user);
    result.passed = inspectionGoodQty === arrivalQty && defectSum === 0;
    await result.save(sessionOptions(session));
  } else {
    const eventId = body.eventId || `${kind}-insp-${bundle.barcode}-${Date.now()}`;
    [result] = await QualityResult.create(
      [
        {
          eventId,
          kind,
          phase: 'inspected',
          bundleId: String(bundle.id),
          orderId: String(bundle.orderId),
          grades,
          defectQty: defectSum,
          arrivalQty,
          inspectionGoodQty,
          goodQty: 0,
          articleLabel,
          lineId,
          inspectedBy: actorLabel(user),
          passed: inspectionGoodQty === arrivalQty && defectSum === 0,
          rackCode: bundle.rackCode || '',
        },
      ],
      sessionOptions(session)
    );
  }
  await writeOrderLog(
    {
      action: inspectAction,
      orderId: bundle.orderId,
      entityType: 'bundle',
      entityCode: bundle.barcode,
      quantity: inspectionGoodQty,
      remarks: grades.map((g) => `${g.code} ${g.qty}`).join(' ') || 'no defects',
    },
    user,
    session
  );
  return result;
};

/**
 * @param {object} params
 */
export const saveGradePass = async ({
  kind,
  bundle,
  body,
  user,
  session,
  inspectedFlag,
  passAction,
  applyPass,
}) => {
  if (!bundle[inspectedFlag]) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Save inspection before passing to the next step.');
  }
  const inspection = await openInspectionForBundle(kind, bundle.id);
  if (!inspection) throw new ApiError(httpStatus.BAD_REQUEST, 'No inspection record found for this bundle.');
  const existingPass = await QualityResult.findOne({ kind, bundleId: String(bundle.id), phase: 'passed' });
  if (existingPass) throw new ApiError(httpStatus.BAD_REQUEST, 'This bundle has already passed QC');

  const goodAddedQty = Number(body.goodAddedQty) || 0;
  const passGoodQty = Number(body.passGoodQty);
  const inspectionGoodQty = Number(inspection.inspectionGoodQty) || 0;
  const maxPass = inspectionGoodQty + goodAddedQty;
  if (!Number.isFinite(passGoodQty) || passGoodQty < 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Pass quantity is invalid');
  }
  if (maxPass > 0 && passGoodQty < 1) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Pass quantity must be at least 1');
  }
  if (maxPass === 0 && passGoodQty !== 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Nothing good to pass when all pieces are defect');
  }
  if (passGoodQty > maxPass) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Pass quantity cannot exceed good after inspection (${inspectionGoodQty}) plus good added (${goodAddedQty})`
    );
  }

  inspection.phase = 'passed';
  inspection.goodAddedQty = goodAddedQty;
  inspection.passGoodQty = passGoodQty;
  inspection.goodQty = passGoodQty;
  inspection.passedBy = actorLabel(user);
  await inspection.save(sessionOptions(session));

  await applyPass(bundle, passGoodQty, body, session);

  await writeOrderLog(
    {
      action: passAction,
      orderId: bundle.orderId,
      entityType: 'bundle',
      entityCode: bundle.barcode,
      quantity: passGoodQty,
      remarks: `added ${goodAddedQty} defects ${inspection.defectQty || 0}`,
    },
    user,
    session
  );
  return inspection;
};