import { PieceBundle, ProductionOrder } from '../../models/production.model.js';
import { QualityResult } from '../../models/quality.model.js';
import { completedBundlesFromLogs } from './floorCompleted.js';

const STILL_AT_SINGLE_PIECE = {
  $or: [{ process: 'created' }, { process: '' }, { process: null }, { process: { $exists: false } }],
};

const CLOSED_BUNDLE = {
  closed: true,
  barcode: { $nin: ['', null] },
};

const NOT_PASSED = {
  floorChecked: { $ne: true },
  checkedGood: { $ne: true },
};

const QUEUE_BUNDLE_FIELDS =
  'barcode orderId qty rackCode floorInspected floorChecked checkedGood process closed finalGood updatedAt';

const COMPLETED_BLOCKER_FIELDS =
  'barcode closed rackCode floorInspected floorChecked checkedGood process';

/**
 * @param {import('mongoose').Document} row
 */
function hemBlockers(row) {
  const blockers = [];
  if (!row.closed) blockers.push('Close bundle on Single piece cutting');
  if (!row.barcode) blockers.push('Close bundle (missing barcode)');
  if (!String(row.rackCode || '').trim()) blockers.push('Place on a bundles rack');
  if (!row.checkedGood && !row.floorChecked) {
    if (row.floorInspected) blockers.push('Pass to next floor after top-up');
    else blockers.push('Complete floor inspection (M2/M4)');
  }
  if (row.process && row.process !== 'created') blockers.push(`Already at ${row.process}`);
  return blockers;
}

/**
 * @param {string[]} bundleIds
 */
async function floorCheckMetaMap(bundleIds) {
  if (!bundleIds.length) return new Map();
  const checks = await QualityResult.aggregate([
    { $match: { kind: 'bundle-check', bundleId: { $in: bundleIds.map(String) } } },
    { $sort: { createdAt: -1 } },
    {
      $group: {
        _id: '$bundleId',
        bundleId: { $first: '$bundleId' },
        phase: { $first: '$phase' },
        goodQty: { $first: '$goodQty' },
        passGoodQty: { $first: '$passGoodQty' },
        inspectionGoodQty: { $first: '$inspectionGoodQty' },
        arrivalQty: { $first: '$arrivalQty' },
        m2Qty: { $first: '$m2Qty' },
        m4Qty: { $first: '$m4Qty' },
        goodAddedQty: { $first: '$goodAddedQty' },
        articleLabel: { $first: '$articleLabel' },
        createdAt: { $first: '$createdAt' },
      },
    },
  ]);
  return new Map(checks.map((row) => [String(row._id), row]));
}

function workingQtyFromMeta(row, meta) {
  const finalGood = Number(row.finalGood) || 0;
  if (finalGood > 0) return finalGood;
  const phase = meta?.phase || '';
  if (phase === 'passed') {
    const pass = Number(meta.passGoodQty) || Number(meta.goodQty) || 0;
    if (pass > 0) return pass;
  }
  if (Number(meta?.arrivalQty) > 0) return Number(meta.arrivalQty);
  return Number(row.qty) || 0;
}

function mapRows(rows, numbers, metaById) {
  return rows.map((row) => {
    const blockers = hemBlockers(row);
    const id = String(row._id || row.id);
    const meta = metaById.get(id);
    return {
      id,
      barcode: row.barcode,
      orderId: String(row.orderId),
      orderNumber: numbers.get(String(row.orderId)) || '',
      qty: workingQtyFromMeta(row, meta),
      arrivalQty: Number(meta?.arrivalQty) || Number(row.qty) || 0,
      rackCode: row.rackCode || '',
      floorInspected: Boolean(row.floorInspected),
      readyForHorizontalHem: blockers.length === 0,
      blockers,
      m2Qty: Number(meta?.m2Qty) || 0,
      m4Qty: Number(meta?.m4Qty) || 0,
      inspectionGoodQty: Number(meta?.inspectionGoodQty) || 0,
      articleLabel: meta?.articleLabel || '',
    };
  });
}

/**
 * Closed bundles on a rack awaiting bundle check, plus closed-off-rack and checked queues for the UI.
 */
export const upcomingFloorChecks = async () => {
  const onRackQuery = {
    $and: [
      CLOSED_BUNDLE,
      { rackCode: { $nin: ['', null] } },
      { floorInspected: { $ne: true } },
      NOT_PASSED,
      STILL_AT_SINGLE_PIECE,
    ],
  };
  const awaitingPassQuery = {
    $and: [
      CLOSED_BUNDLE,
      { rackCode: { $nin: ['', null] } },
      { floorInspected: true },
      NOT_PASSED,
      STILL_AT_SINGLE_PIECE,
    ],
  };
  const pendingRackQuery = {
    $and: [CLOSED_BUNDLE, { $or: [{ rackCode: '' }, { rackCode: null }, { rackCode: { $exists: false } }] }, NOT_PASSED, STILL_AT_SINGLE_PIECE],
  };
  const receivedQuery = {
    $and: [CLOSED_BUNDLE, { $or: [{ floorChecked: true }, { checkedGood: true }] }, STILL_AT_SINGLE_PIECE],
  };

  const queueFind = (query) =>
    PieceBundle.find(query).select(QUEUE_BUNDLE_FIELDS).sort({ updatedAt: -1 }).limit(200).lean();

  const [[onRack, awaitingPass, pendingRack, received], completed] = await Promise.all([
    Promise.all([
      queueFind(onRackQuery),
      queueFind(awaitingPassQuery),
      queueFind(pendingRackQuery),
      queueFind(receivedQuery),
    ]),
    completedBundlesFromLogs(['bundle-check']),
  ]);

  const orderIds = [...new Set([...onRack, ...awaitingPass, ...pendingRack, ...received].map((row) => row.orderId))];
  const allIds = [...onRack, ...awaitingPass, ...pendingRack, ...received].map((row) => String(row._id || row.id));
  const checkedBarcodes = [...new Set(completed.map((row) => row.barcode).filter(Boolean))];

  const [orders, metaById, completedBundles] = await Promise.all([
    orderIds.length
      ? ProductionOrder.find({ _id: { $in: orderIds } }).select('orderNumber').lean()
      : Promise.resolve([]),
    floorCheckMetaMap(allIds),
    checkedBarcodes.length
      ? PieceBundle.find({ barcode: { $in: checkedBarcodes } }).select(COMPLETED_BLOCKER_FIELDS).lean()
      : Promise.resolve([]),
  ]);
  const numbers = new Map(orders.map((order) => [String(order._id), order.orderNumber || '']));

  const bundleByBarcode = new Map(completedBundles.map((row) => [row.barcode, row]));
  const completedEnriched = completed.map((row) => {
    const bundle = row.barcode ? bundleByBarcode.get(row.barcode) : null;
    if (!bundle) return row;
    const blockers = hemBlockers(bundle);
    return {
      ...row,
      rackCode: row.rackCode || bundle.rackCode || '',
      readyForHorizontalHem: blockers.length === 0,
      blockers,
      movedOn: Boolean(bundle.process && bundle.process !== 'created'),
    };
  });

  const receivedAll = mapRows(received, numbers, metaById);
  const receivedNeedsAttention = receivedAll.filter((row) => !row.readyForHorizontalHem);

  const inspectNow = mapRows(onRack, numbers, metaById);
  const awaitingPassRows = mapRows(awaitingPass, numbers, metaById);

  return {
    results: inspectNow,
    awaitingPass: awaitingPassRows,
    pendingPlacement: mapRows(pendingRack, numbers, metaById),
    received: receivedNeedsAttention,
    completed: completedEnriched,
    counts: {
      waiting: inspectNow.length + pendingRack.length,
      inspectNow: inspectNow.length,
      awaitingPass: awaitingPassRows.length,
      pendingPlacement: pendingRack.length,
      received: awaitingPassRows.length + receivedNeedsAttention.length,
      completed: completedEnriched.length,
    },
  };
};