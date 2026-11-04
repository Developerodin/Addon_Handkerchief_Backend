import httpStatus from 'http-status';
import ApiError from '../../utils/ApiError.js';
import { PieceBundle } from '../../models/production.model.js';
import { QualityResult } from '../../models/quality.model.js';
import { activeRack, logBundles, orderMap, shapeBundle } from './bundleFloor.js';

const GRADES = ['long', 'hemming', 'sporting', 'diving', 'rejection'];

/**
 * Non-negative whole count.
 * @param {unknown} value
 * @param {string} label
 */
const whole = (value, label) => {
  const count = value == null || value === '' ? 0 : Number(value);
  if (!Number.isInteger(count) || count < 0) throw new ApiError(httpStatus.BAD_REQUEST, `${label} count is invalid`);
  return count;
};

/**
 * Bundle ids that already have a final QC result.
 */
const checkedIds = async () => {
  const rows = await QualityResult.find({ kind: 'final-qc' }).select('bundleId');
  return new Set(rows.map((row) => String(row.bundleId)));
};

/**
 * Thread-cut bundles still waiting for final QC.
 */
export const upcomingFinalQc = async () => {
  const skip = await checkedIds();
  const rows = await PieceBundle.find({ closed: true, process: 'thread-cut', rackCode: { $nin: ['', null] } })
    .sort({ updatedAt: -1 })
    .limit(200);
  const waiting = rows.filter((row) => !skip.has(String(row.id)));
  const orders = await orderMap(waiting);
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const [doneToday, passed] = await Promise.all([
    PieceBundle.countDocuments({ process: 'final-qc', updatedAt: { $gte: start } }),
    PieceBundle.countDocuments({ process: 'final-qc', finalGood: { $gt: 0 } }),
  ]);
  return {
    results: waiting.map((row) => shapeBundle(row, orders)),
    active: [],
    counts: { waiting: waiting.length, onStation: 0, doneToday, onRack: passed },
  };
};

/**
 * Records the six final-QC counts. Only a good count moves the bundle on.
 * @param {object} body
 * @param {object} [_params]
 * @param {object | null} [user]
 */
export const recordFinalQc = async (body, _params, user) => {
  const barcode = String(body.bundleBarcode || '').trim();
  if (!barcode) throw new ApiError(httpStatus.BAD_REQUEST, 'Bundle barcode is required');
  const bundle = await PieceBundle.findOne({ barcode });
  if (!bundle) throw new ApiError(httpStatus.BAD_REQUEST, 'Bundle not found');
  if (bundle.process !== 'thread-cut' || !bundle.closed || !bundle.rackCode) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'This bundle is not waiting for final QC');
  }
  const existing = await QualityResult.findOne({ kind: 'final-qc', bundleId: String(bundle.id) });
  if (existing) throw new ApiError(httpStatus.BAD_REQUEST, 'This bundle is already final checked');
  const good = whole(body.good, 'Good');
  const grades = [];
  for (const code of GRADES) {
    const qty = whole(body[code], code);
    if (!qty) continue;
    const rackCode = body.racks?.[code];
    if (!rackCode) throw new ApiError(httpStatus.BAD_REQUEST, 'Rack is required');
    const rack = await activeRack(rackCode);
    grades.push({ code, qty, rackCode: rack.code });
  }
  const sum = good + grades.reduce((total, grade) => total + grade.qty, 0);
  if (sum !== bundle.qty) throw new ApiError(httpStatus.BAD_REQUEST, 'Final QC counts must sum to the bundle');
  await QualityResult.create({
    eventId: `final-qc-${bundle.barcode}`,
    kind: 'final-qc',
    bundleId: String(bundle.id),
    orderId: String(bundle.orderId),
    goodQty: good,
    defectQty: sum - good,
    grades,
    passed: good > 0,
  });
  if (good > 0) {
    bundle.process = 'final-qc';
    bundle.finalGood = good;
    await bundle.save();
  }
  await logBundles([bundle], { action: 'final-qc', fromLocation: bundle.rackCode, toLocation: bundle.rackCode, remarks: `good ${good}` }, user);
  return bundle;
};
