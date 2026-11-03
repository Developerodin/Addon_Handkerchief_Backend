import httpStatus from 'http-status';
import mongoose from 'mongoose';
import ApiError from '../../utils/ApiError.js';
import { FabricLot, FabricRoll, GoodsReceipt, PackingList, PurchaseOrder, StockMovement, VendorReturn } from '../../models/store.model.js';
import { cutoffKey } from './cutoffGate.js';
import {
  dateRange,
  daysBetween,
  isOpenOrder,
  lineAmount,
  lineAmountGst,
  matchesQuery,
  median,
  round3,
  stillDue,
  sumOrdered,
  sumReceivedLots,
  supplierLabel,
  weekKey,
} from './poAnalyticsMath.js';
import { buildCycle, buildLines, buildLots, buildPacking, buildReceipts, buildReturns, buildStorage, buildTimeline } from './poDossier.js';

const OFF_RACK = new Set(['', 'floor', 'vendor', 'dispatched']);

/**
 * @param {unknown} value
 */
function idOf(value) {
  return value ? String(value) : '';
}

/**
 * Purchase orders for the ledger, before supplier and search narrowing.
 * @param {object} query
 */
async function loadOrders(query) {
  const filter = {};
  if (query.status) filter.status = String(query.status);
  else if (query.includeDrafts !== '1') filter.status = { $ne: 'Draft' };
  if (query.dateField !== 'received') {
    const range = dateRange(query);
    if (range) filter.purchaseDate = range;
  }
  return PurchaseOrder.find(filter)
    .select('number supplierName purchaseDate status lines receivedLots statusHistory')
    .lean();
}

/**
 * Lot quantity when it was written; otherwise the weighed rolls.
 * @param {object[]} orders
 */
async function receivedQtyByPo(orders) {
  const totals = new Map();
  const need = [];
  orders.forEach((order) => {
    const qty = sumReceivedLots(order.receivedLots);
    if (qty > 0) totals.set(idOf(order._id), qty);
    else need.push(order._id);
  });
  if (!need.length) return totals;
  const rolls = await FabricRoll.find({ poId: { $in: need } }).select('poId scaleWeight').lean();
  rolls.forEach((roll) => {
    const key = idOf(roll.poId);
    totals.set(key, (totals.get(key) || 0) + (Number(roll.scaleWeight) || 0));
  });
  return totals;
}

/**
 * Earliest goods-receipt date for each order.
 * @param {unknown[]} poIds
 */
async function firstReceiptByPo(poIds) {
  const map = new Map();
  if (!poIds.length) return map;
  const rows = await GoodsReceipt.find({ poId: { $in: poIds } }).select('poId receivedDate').lean();
  rows.forEach((row) => {
    const at = row.receivedDate ? new Date(row.receivedDate) : null;
    if (!at || Number.isNaN(at.getTime())) return;
    const key = idOf(row.poId);
    const prev = map.get(key);
    if (!prev || at < prev) map.set(key, at);
  });
  return map;
}

/**
 * Keeps orders that have a receipt inside the requested window.
 * @param {object[]} orders
 * @param {object} query
 */
async function filterByReceiptDate(orders, query) {
  const range = dateRange(query);
  if (query.dateField !== 'received' || !range) return orders;
  const rows = await GoodsReceipt.find({ receivedDate: range }).select('poId').lean();
  const allowed = new Set(rows.map((row) => idOf(row.poId)));
  return orders.filter((order) => allowed.has(idOf(order._id)));
}

/**
 * One ledger row.
 * @param {object} order
 * @param {number} received
 * @param {Date | null} firstReceipt
 * @param {Date} now
 * @param {string} dateField
 */
function orderRow(order, received, firstReceipt, now, dateField) {
  const lines = order.lines || [];
  const ordered = sumOrdered(lines);
  const due = stillDue(ordered, received);
  const history = order.statusHistory || [];
  const last = history[history.length - 1];
  const weekSource = dateField === 'received' ? firstReceipt : order.purchaseDate;
  return {
    id: idOf(order._id),
    number: order.number,
    supplier: supplierLabel(order.supplierName),
    purchaseDate: order.purchaseDate || null,
    status: order.status,
    ordered: round3(ordered),
    received: round3(received),
    stillDue: round3(due),
    value: round3(lines.reduce((sum, line) => sum + lineAmount(line), 0)),
    valueWithGst: round3(lines.reduce((sum, line) => sum + lineAmountGst(line), 0)),
    days: daysBetween(order.purchaseDate, now) ?? 0,
    lastUser: last?.userName || '',
    open: isOpenOrder(order.status, due),
    receiptDays: firstReceipt ? daysBetween(order.purchaseDate, firstReceipt) : null,
    week: weekKey(weekSource),
  };
}

/**
 * Adds one order into the supplier and week buckets.
 * @param {Map<string, object>} suppliers
 * @param {Map<string, object>} weeks
 * @param {ReturnType<typeof orderRow>} row
 */
function addBucket(suppliers, weeks, row) {
  if (!suppliers.has(row.supplier)) {
    suppliers.set(row.supplier, { supplier: row.supplier, orders: 0, ordered: 0, received: 0, stillDue: 0, value: 0 });
  }
  const supplier = suppliers.get(row.supplier);
  supplier.orders += 1;
  supplier.ordered += row.ordered;
  supplier.received += row.received;
  supplier.stillDue += row.stillDue;
  supplier.value += row.value;
  if (!row.week) return;
  if (!weeks.has(row.week)) weeks.set(row.week, { week: row.week, orders: 0, ordered: 0 });
  const week = weeks.get(row.week);
  week.orders += 1;
  week.ordered += row.ordered;
}

/**
 * Totals, supplier bars, and the weekly count.
 * @param {ReturnType<typeof orderRow>[]} rows
 */
function summarize(rows) {
  const suppliers = new Map();
  const weeks = new Map();
  rows.forEach((row) => addBucket(suppliers, weeks, row));
  const bySupplier = [...suppliers.values()]
    .map((row) => ({
      ...row,
      ordered: round3(row.ordered),
      received: round3(row.received),
      stillDue: round3(row.stillDue),
      value: round3(row.value),
    }))
    .sort((a, b) => b.ordered - a.ordered || a.supplier.localeCompare(b.supplier));
  const byWeek = [...weeks.values()]
    .map((row) => ({ ...row, ordered: round3(row.ordered) }))
    .sort((a, b) => a.week.localeCompare(b.week));
  const totals = rows.reduce(
    (sum, row) => ({
      orders: sum.orders + 1,
      orderedQty: sum.orderedQty + row.ordered,
      receivedQty: sum.receivedQty + row.received,
      stillDue: sum.stillDue + row.stillDue,
      value: sum.value + row.value,
      valueWithGst: sum.valueWithGst + row.valueWithGst,
      openOrders: sum.openOrders + (row.open ? 1 : 0),
    }),
    { orders: 0, orderedQty: 0, receivedQty: 0, stillDue: 0, value: 0, valueWithGst: 0, openOrders: 0 }
  );
  return {
    totals: {
      ...totals,
      suppliers: suppliers.size,
      orderedQty: round3(totals.orderedQty),
      receivedQty: round3(totals.receivedQty),
      stillDue: round3(totals.stillDue),
      value: round3(totals.value),
      valueWithGst: round3(totals.valueWithGst),
      medianDaysToReceipt: median(rows.map((row) => row.receiptDays)),
    },
    bySupplier,
    byWeek,
  };
}

/**
 * Ledger for the purchase-order analytics screen.
 * @param {object} query
 */
export async function poAnalytics(query) {
  let orders = await loadOrders(query);
  const needle = String(query.q || '').trim().toLowerCase();
  if (needle) orders = orders.filter((order) => matchesQuery(order, needle));
  orders = await filterByReceiptDate(orders, query);
  const supplierOptions = [...new Set(orders.map((order) => supplierLabel(order.supplierName)))].sort((a, b) =>
    a.localeCompare(b)
  );
  if (query.supplier) {
    const name = String(query.supplier);
    orders = orders.filter((order) => supplierLabel(order.supplierName) === name);
  }
  const [receivedMap, firstMap] = await Promise.all([
    receivedQtyByPo(orders),
    firstReceiptByPo(orders.map((order) => order._id)),
  ]);
  const now = new Date();
  const dateField = query.dateField === 'received' ? 'received' : 'purchase';
  const rows = orders
    .map((order) => orderRow(order, receivedMap.get(idOf(order._id)) || 0, firstMap.get(idOf(order._id)) || null, now, dateField))
    .sort((a, b) => String(b.purchaseDate || '').localeCompare(String(a.purchaseDate || '')) || a.number.localeCompare(b.number));
  const summary = summarize(rows);
  return {
    ...summary,
    supplierOptions,
    orders: rows.map(({ receiptDays, week, open, ...row }) => row),
  };
}

/**
 * Latest to-location, and the first time a roll of this order sat on a rack.
 * @param {string[]} barcodes
 */
async function rollPlaces(barcodes) {
  const locations = new Map();
  if (!barcodes.length) return { locations, firstRack: null };
  const rows = await StockMovement.find({ entityType: 'roll', entityId: { $in: barcodes } }).sort({ createdAt: 1 }).lean();
  let firstRack = null;
  rows.forEach((row) => {
    const location = row.toLocation || '';
    locations.set(row.entityId, location);
    if (!firstRack && location && !OFF_RACK.has(location)) firstRack = { at: row.createdAt, rack: location };
  });
  return { locations, firstRack };
}

/**
 * Everything recorded against one purchase order.
 * @param {string} poId
 */
export async function poDossier(poId) {
  if (!mongoose.isValidObjectId(poId)) throw new ApiError(httpStatus.NOT_FOUND, 'Purchase order not found');
  const order = await PurchaseOrder.findById(poId).lean();
  if (!order) throw new ApiError(httpStatus.NOT_FOUND, 'Purchase order not found');
  const [lots, receipts, rolls, returns] = await Promise.all([
    FabricLot.find({ poId: order._id }).lean(),
    GoodsReceipt.find({ poId: order._id }).sort({ receivedDate: 1 }).lean(),
    FabricRoll.find({ poId: order._id }).lean(),
    VendorReturn.find({ poId: order._id }).sort({ issuedAt: 1 }).lean(),
  ]);
  const lotIds = lots.map((lot) => lot._id);
  const packing = lotIds.length ? await PackingList.find({ lotId: { $in: lotIds } }).lean() : [];
  const { locations, firstRack } = await rollPlaces(rolls.map((roll) => roll.barcode));
  const approved = new Set(
    lots.flatMap((lot) => (lot.cutoffs || []).filter((row) => row.approved).map((row) => String(row.fabricId)))
  );
  const names = new Map((order.lines || []).map((line) => [cutoffKey(line), line.fabricName || line.lineId]));
  const received = sumReceivedLots(order.receivedLots) > 0
    ? sumReceivedLots(order.receivedLots)
    : rolls.reduce((sum, roll) => sum + (Number(roll.scaleWeight) || 0), 0);
  const firstReceipt = receipts.find((row) => row.receivedDate) || null;
  return {
    header: {
      id: idOf(order._id),
      number: order.number,
      supplierName: supplierLabel(order.supplierName),
      supplierAddress: order.supplierAddress || '',
      supplierTerms: order.supplierTerms || '',
      creditDays: order.creditDays || 0,
      notes: order.notes || '',
      status: order.status,
      purchaseDate: order.purchaseDate || null,
      estimatedDelivery: order.estimatedDelivery || null,
    },
    cycle: buildCycle(order, firstReceipt ? new Date(firstReceipt.receivedDate) : null, received),
    timeline: buildTimeline(order, packing, receipts, firstRack),
    lines: buildLines(order, rolls, approved),
    lots: buildLots(lots, names),
    packing: buildPacking(packing),
    ...buildReceipts(receipts, order.receivedLots),
    storage: buildStorage(locations, rolls),
    returns: buildReturns(returns),
  };
}
