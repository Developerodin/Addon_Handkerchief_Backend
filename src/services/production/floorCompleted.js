import { CutPiece, PieceBundle, ProductionOrder, ProductionOrderLog } from '../../models/production.model.js';
import { QualityResult } from '../../models/quality.model.js';
import { orderMap, shapeBundle, transferableQty } from './bundleFloor.js';

const DEFAULT_SINCE_DAYS = 14;

/**
 * @param {number} days
 */
const since = (days = DEFAULT_SINCE_DAYS) => {
  const start = new Date();
  start.setDate(start.getDate() - days);
  return start;
};

/**
 * Latest log per entity code.
 * @param {object[]} logs
 */
/**
 * M4 counted on the table, summed from cut pieces linked to each bundle.
 * @param {import('mongoose').Types.ObjectId[]} bundleIds
 */
const m4QtyByBundleId = async (bundleIds) => {
  if (!bundleIds?.length) return new Map();
  const rows = await CutPiece.aggregate([
    { $match: { bundleId: { $in: bundleIds } } },
    { $group: { _id: '$bundleId', m4Qty: { $sum: { $ifNull: ['$m4Qty', 0] } } } },
  ]);
  return new Map(rows.map((row) => [String(row._id), row.m4Qty || 0]));
};

const dedupeLogs = (logs) => {
  const seen = new Set();
  const unique = [];
  for (const log of logs) {
    const key = `${log.entityType}:${log.entityCode}`;
    if (!log.entityCode || seen.has(key)) continue;
    seen.add(key);
    unique.push(log);
  }
  return unique;
};

/**
 * Bundles finished on this floor and moved on (from order log).
 * @param {string[]} actions
 * @param {number} [days]
 */
export const completedBundlesFromLogs = async (actions, days = DEFAULT_SINCE_DAYS) => {
  if (!actions?.length) return [];
  const logs = dedupeLogs(
    await ProductionOrderLog.find({
      action: { $in: actions },
      entityType: 'bundle',
      entityCode: { $nin: ['', null] },
      at: { $gte: since(days) },
    })
      .sort({ at: -1 })
      .limit(300)
      .lean()
  );
  if (!logs.length) return [];
  const barcodes = logs.map((row) => row.entityCode);
  const bundles = await PieceBundle.find({ barcode: { $in: barcodes } });
  const bundleByCode = new Map(bundles.map((row) => [row.barcode, row]));
  const orders = await orderMap(bundles);
  const m4Map = await m4QtyByBundleId(bundles.map((row) => row._id));
  const finalQcById = new Map();
  if (actions.includes('final-qc') && bundles.length) {
    const qcs = await QualityResult.find({
      kind: 'final-qc',
      bundleId: { $in: bundles.map((row) => String(row._id)) },
    })
      .select('bundleId goodQty defectQty grades')
      .lean();
    for (const row of qcs) {
      if (!finalQcById.has(row.bundleId)) finalQcById.set(row.bundleId, row);
    }
  }
  const finalCheckingById = new Map();
  if (actions.includes('final-checking') && bundles.length) {
    const rows = await QualityResult.find({
      kind: 'final-checking',
      bundleId: { $in: bundles.map((row) => String(row._id)) },
    })
      .select('bundleId goodQty defectQty rackCode')
      .lean();
    for (const row of rows) {
      if (!finalCheckingById.has(row.bundleId)) finalCheckingById.set(row.bundleId, row);
    }
  }
  const bundleCheckById = new Map();
  if (actions.includes('bundle-check') && bundles.length) {
    const checks = await QualityResult.find({
      kind: 'bundle-check',
      bundleId: { $in: bundles.map((row) => String(row._id)) },
    })
      .sort({ createdAt: -1 })
      .select('bundleId m2Qty defectQty m4Qty goodQty')
      .lean();
    for (const row of checks) {
      if (!bundleCheckById.has(row.bundleId)) bundleCheckById.set(row.bundleId, row);
    }
  }
  return logs
    .map((log) => {
      const bundle = bundleByCode.get(log.entityCode);
      if (!bundle) return null;
      const pieceM4 = bundle ? m4Map.get(String(bundle._id)) || 0 : 0;
      const bundleM4 = bundle ? Number(bundle.m4Qty) || 0 : 0;
      let m4Qty = Math.max(bundleM4, pieceM4);
      const action = log.action || '';
      let m2Qty = 0;
      let goodQty = 0;
      let defectQty = 0;
      let defectGrades = [];
      const floorCheck = bundle ? bundleCheckById.get(String(bundle._id)) : null;
      if (floorCheck && action === 'bundle-check') {
        m2Qty = Number(floorCheck.m2Qty ?? floorCheck.defectQty) || 0;
        m4Qty = Number(floorCheck.m4Qty) || 0;
        goodQty = Number(floorCheck.goodQty) || 0;
      }
      const finalQc = bundle ? finalQcById.get(String(bundle._id)) : null;
      if (finalQc && action === 'final-qc') {
        goodQty = Number(finalQc.goodQty) || 0;
        defectQty = Number(finalQc.defectQty) || 0;
        defectGrades = (finalQc.grades || []).filter((grade) => Number(grade.qty) > 0);
      }
      const finalChecking = bundle ? finalCheckingById.get(String(bundle._id)) : null;
      if (finalChecking && action === 'final-checking') {
        goodQty = Number(finalChecking.goodQty) || 0;
        defectQty = Number(finalChecking.defectQty) || 0;
      }
      const base = { ...shapeBundle(bundle, orders), m4Qty };
      // Snapshot at event time — do not use today's bundle.finalGood for older floor logs.
      const loggedQty = Number(log.quantity) || 0;
      let transferQty = loggedQty;
      if (action === 'final-checking' && finalChecking) {
        transferQty = Number(finalChecking.goodQty) || loggedQty;
      } else if (action === 'final-qc' && finalQc) {
        transferQty = Number(finalQc.goodQty) || loggedQty;
      } else if (action === 'bundle-check' && goodQty > 0) {
        transferQty = goodQty;
      } else if (transferQty < 1 && bundle) {
        transferQty = transferableQty(bundle);
      }
      return {
        ...base,
        transferQty,
        qtyAtEvent: transferQty,
        goodQty,
        defectQty,
        defectGrades,
        m2Qty,
        m4Qty,
        transferredTo: log.toLocation || bundle?.rackCode || bundle?.process || '',
        completedAt: log.at,
        completedAction: log.action,
      };
    })
    .filter((row) => row && row.barcode);
};

/**
 * Cut pieces finished on this floor.
 * @param {string[]} actions
 * @param {number} [days]
 */
export const completedPiecesFromLogs = async (actions, days = DEFAULT_SINCE_DAYS) => {
  if (!actions?.length) return [];
  const logs = dedupeLogs(
    await ProductionOrderLog.find({
      action: { $in: actions },
      entityCode: { $nin: ['', null] },
      at: { $gte: since(days) },
    })
      .sort({ at: -1 })
      .limit(300)
      .lean()
  );
  if (!logs.length) return [];
  const barcodes = logs.map((row) => row.entityCode);
  const pieces = await CutPiece.find({ barcode: { $in: barcodes } }).lean();
  const pieceSet = new Set(pieces.map((row) => row.barcode));
  const pieceLogs = logs.filter((row) => pieceSet.has(row.entityCode));
  if (!pieceLogs.length) return [];
  const pieceByCode = new Map(pieces.map((row) => [row.barcode, row]));
  const orderIds = [...new Set(pieces.map((row) => String(row.orderId)))];
  const orders = await ProductionOrder.find({ _id: { $in: orderIds } }).select('orderNumber');
  const orderNumbers = new Map(orders.map((order) => [String(order.id), order.orderNumber || '']));
  return pieceLogs
    .map((log) => {
      const piece = pieceByCode.get(log.entityCode);
      return {
        barcode: log.entityCode,
        orderId: String(log.orderId || piece?.orderId || ''),
        orderNumber: orderNumbers.get(String(log.orderId || piece?.orderId)) || '',
        rollBarcode: piece?.rollBarcode || '',
        rackCode: piece?.rackCode || '',
        process: piece?.process || '',
        transferredTo: log.toLocation || piece?.rackCode || '',
        completedAt: log.at,
        completedAction: log.action,
      };
    })
    .filter((row) => row.barcode);
};

/**
 * Rolls cut on vertical cutting (piece flow starts).
 * @param {string[]} actions
 * @param {number} [days]
 */
export const completedRollsFromLogs = async (actions, days = DEFAULT_SINCE_DAYS) => {
  if (!actions?.length) return [];
  const logs = dedupeLogs(
    await ProductionOrderLog.find({
      action: { $in: actions },
      entityType: 'roll',
      entityCode: { $nin: ['', null] },
      at: { $gte: since(days) },
    })
      .sort({ at: -1 })
      .limit(200)
      .lean()
  );
  if (!logs.length) return [];
  const orderIds = [...new Set(logs.map((row) => String(row.orderId)).filter(Boolean))];
  const orders = await ProductionOrder.find({ _id: { $in: orderIds } }).select('orderNumber');
  const orderNumbers = new Map(orders.map((order) => [String(order.id), order.orderNumber || '']));
  return logs.map((log) => ({
    rollBarcode: log.entityCode,
    orderId: String(log.orderId || ''),
    orderNumber: orderNumbers.get(String(log.orderId)) || '',
    transferredTo: log.toLocation || 'selvage',
    completedAt: log.at,
    completedAction: log.action,
  }));
};