import httpStatus from 'http-status';
import ApiError from '../../utils/ApiError.js';
import { PieceBundle } from '../../models/production.model.js';
import { QualityResult } from '../../models/quality.model.js';
import { logBundles, orderMap, rackOfType, shapeBundle } from './bundleFloor.js';

/**
 * Bundle ids already sent toward packing.
 */
const checkedIds = async () => {
  const rows = await QualityResult.find({ kind: 'final-checking' }).select('bundleId');
  return new Set(rows.map((row) => String(row.bundleId)));
};

/**
 * Normal bundles after the break, and embroidery or sticker bundles after the second iron.
 */
export const upcomingFinalChecking = async () => {
  const skip = await checkedIds();
  const rows = await PieceBundle.find({
    closed: true,
    rackCode: { $nin: ['', null] },
    $or: [
      { process: 'broken', route: 'normal' },
      { process: 'iron-after' },
    ],
  })
    .sort({ updatedAt: -1 })
    .limit(200);
  const waiting = rows.filter((row) => !skip.has(String(row.id)));
  const orders = await orderMap(waiting);
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const doneToday = await QualityResult.countDocuments({ kind: 'final-checking', createdAt: { $gte: start } });
  return {
    results: waiting.map((row) => shapeBundle(row, orders)),
    active: [],
    counts: { waiting: waiting.length, onStation: 0, doneToday, onRack: waiting.length },
  };
};

/**
 * Whole non-negative count.
 * @param {unknown} value
 * @param {string} label
 */
const whole = (value, label) => {
  const count = value == null || value === '' ? 0 : Number(value);
  if (!Number.isInteger(count) || count < 0) throw new ApiError(httpStatus.BAD_REQUEST, `${label} count is invalid`);
  return count;
};

/**
 * Defects leave. The good count is what packing can take, on a packing rack.
 * @param {object} body
 * @param {object} [_params]
 * @param {object | null} [user]
 */
export const recordFinalChecking = async (body, _params, user) => {
  const barcode = String(body.bundleBarcode || '').trim();
  if (!barcode) throw new ApiError(httpStatus.BAD_REQUEST, 'Bundle barcode is required');
  const bundle = await PieceBundle.findOne({ barcode });
  if (!bundle) throw new ApiError(httpStatus.BAD_REQUEST, 'Bundle not found');
  const normal = bundle.process === 'broken' && bundle.route === 'normal';
  const after = bundle.process === 'iron-after';
  if ((!normal && !after) || !bundle.rackCode) throw new ApiError(httpStatus.BAD_REQUEST, 'This bundle is not ready for final checking');
  const existing = await QualityResult.findOne({ kind: 'final-checking', bundleId: String(bundle.id) });
  if (existing) throw new ApiError(httpStatus.BAD_REQUEST, 'This bundle is already final checked');
  const good = whole(body.good, 'Good');
  const defect = whole(body.defect, 'Defect');
  if (good + defect !== bundle.finalGood) throw new ApiError(httpStatus.BAD_REQUEST, 'Final checking counts must sum to the good count');
  let rackCode = '';
  if (good > 0) {
    const rack = await rackOfType(body.rackCode, 'packing', 'This rack is not for packing');
    rackCode = rack.code;
  }
  await QualityResult.create({
    eventId: `final-checking-${bundle.barcode}`,
    kind: 'final-checking',
    bundleId: String(bundle.id),
    orderId: String(bundle.orderId),
    goodQty: good,
    defectQty: defect,
    rackCode,
    passed: good > 0,
  });
  bundle.finalGood = good;
  bundle.rackCode = rackCode;
  await bundle.save();
  await logBundles([bundle], { action: 'final-checking', fromLocation: '', toLocation: rackCode, remarks: `defect ${defect}` }, user);
  return bundle;
};
