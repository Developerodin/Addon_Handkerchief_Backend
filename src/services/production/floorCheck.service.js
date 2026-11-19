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

/**
 * @param {import('mongoose').Document} row
 */
function hemBlockers(row) {
  const blockers = [];
  if (!row.closed) blockers.push('Close bundle on Single piece cutting');
  if (!row.barcode) blockers.push('Close bundle (missing barcode)');
  if (!String(row.rackCode || '').trim()) blockers.push('Place on a bundles rack');
  if (!row.checkedGood && !row.floorChecked) blockers.push('Complete floor check counts');
  if (row.process && row.process !== 'created') blockers.push(`Already at ${row.process}`);
  return blockers;
}

/**
 * @param {object[]} rows
 * @param {Map<string, string>} numbers
 */
async function floorGoodQtyMap(bundleIds) {
  if (!bundleIds.length) return new Map();
  const checks = await QualityResult.find({
    kind: 'bundle-check',
    bundleId: { $in: bundleIds.map(String) },
  })
    .sort({ createdAt: -1 })
    .select('bundleId goodQty')
    .lean();
  const map = new Map();
  for (const row of checks) {
    const id = String(row.bundleId);
    if (!map.has(id)) map.set(id, Number(row.goodQty) || 0);
  }
  return map;
}

function displayQty(row, floorGood) {
  const finalGood = Number(row.finalGood) || 0;
  if (finalGood > 0) return finalGood;
  if (floorGood > 0) return floorGood;
  return Number(row.qty) || 0;
}

function mapRows(rows, numbers, floorGoodById) {
  return rows.map((row) => {
    const blockers = hemBlockers(row);
    const id = String(row._id || row.id);
    return {
      id,
      barcode: row.barcode,
      orderId: String(row.orderId),
      orderNumber: numbers.get(String(row.orderId)) || '',
      qty: displayQty(row, floorGoodById.get(id) || 0),
      rackCode: row.rackCode || '',
      readyForHorizontalHem: blockers.length === 0,
      blockers,
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
      { floorChecked: { $ne: true } },
      { checkedGood: { $ne: true } },
      STILL_AT_SINGLE_PIECE,
    ],
  };
  const pendingRackQuery = {
    $and: [
      CLOSED_BUNDLE,
      { $or: [{ rackCode: '' }, { rackCode: null }, { rackCode: { $exists: false } }] },
      { floorChecked: { $ne: true } },
      { checkedGood: { $ne: true } },
      STILL_AT_SINGLE_PIECE,
    ],
  };
  const receivedQuery = {
    $and: [
      CLOSED_BUNDLE,
      { $or: [{ floorChecked: true }, { checkedGood: true }] },
      STILL_AT_SINGLE_PIECE,
    ],
  };

  const [onRack, pendingRack, received] = await Promise.all([
    PieceBundle.find(onRackQuery).sort({ updatedAt: -1 }).limit(200).lean(),
    PieceBundle.find(pendingRackQuery).sort({ updatedAt: -1 }).limit(200).lean(),
    PieceBundle.find(receivedQuery).sort({ updatedAt: -1 }).limit(200).lean(),
  ]);

  const orderIds = [...new Set([...onRack, ...pendingRack, ...received].map((row) => row.orderId))];
  const orders = orderIds.length
    ? await ProductionOrder.find({ _id: { $in: orderIds } }).select('orderNumber').lean()
    : [];
  const numbers = new Map(orders.map((order) => [String(order._id), order.orderNumber || '']));

  const allIds = [...onRack, ...pendingRack, ...received].map((row) => String(row._id || row.id));
  const floorGoodById = await floorGoodQtyMap(allIds);

  const completed = await completedBundlesFromLogs(['bundle-check']);
  const checkedBarcodes = [...new Set(completed.map((row) => row.barcode).filter(Boolean))];
  const completedBundles = checkedBarcodes.length
    ? await PieceBundle.find({ barcode: { $in: checkedBarcodes } }).lean()
    : [];
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

  const receivedAll = mapRows(received, numbers, floorGoodById);
  const receivedNeedsAttention = receivedAll.filter((row) => !row.readyForHorizontalHem);

  return {
    results: mapRows(onRack, numbers, floorGoodById),
    pendingPlacement: mapRows(pendingRack, numbers, floorGoodById),
    received: receivedNeedsAttention,
    completed: completedEnriched,
    counts: {
      waiting: onRack.length,
      pendingPlacement: pendingRack.length,
      received: receivedNeedsAttention.length,
      completed: completedEnriched.length,
    },
  };
};