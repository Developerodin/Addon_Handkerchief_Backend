import httpStatus from 'http-status';
import mongoose from 'mongoose';
import ApiError from '../../utils/ApiError.js';
import { StockMovement } from '../../models/store.model.js';
import { ProductionOrder } from '../../models/production.model.js';
import { dateRange } from './poAnalyticsMath.js';
import { applyGroup, buildArticles, productsFor, seedOrder } from './consumptionBom.js';
import { cleanQuery, closeUse, composeTotals, isoDate, labelOf, nameKey, round3, zeroTotals } from './consumptionMath.js';

const MOVEMENT_CAP = 200;

/**
 * Issue and return rolls that belong to a production order.
 * @param {object} query
 * @param {{ orderId?: string, day?: string }} scope
 */
function movementMatch(query, scope) {
  const match = {
    entityType: 'roll',
    kind: { $in: ['issue', 'return-to-rack'] },
    orderId: { $exists: true, $ne: null },
  };
  if (scope.orderId) match.orderId = new mongoose.Types.ObjectId(scope.orderId);
  if (scope.day && /^\d{4}-\d{2}-\d{2}$/.test(scope.day)) {
    match.createdAt = {
      $gte: new Date(`${scope.day}T00:00:00.000Z`),
      $lte: new Date(`${scope.day}T23:59:59.999Z`),
    };
    return match;
  }
  const range = dateRange(query);
  if (range) match.createdAt = range;
  return match;
}

/**
 * One row per order, fabric, kind, and day. Detail also keeps the article line.
 * @param {object} match
 * @param {boolean} withLine
 */
function aggregateMovements(match, withLine) {
  const id = {
    orderId: '$orderId',
    fabricCatalogId: { $ifNull: ['$fabricCatalogId', ''] },
    fabric: { $ifNull: ['$fabricName', ''] },
    bomLineId: { $ifNull: ['$bomLineId', ''] },
    kind: '$kind',
    day: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'UTC' } },
  };
  if (withLine) id.lineId = { $ifNull: ['$lineId', ''] };
  return StockMovement.aggregate([
    { $match: match },
    {
      $group: {
        _id: id,
        rolls: { $sum: 1 },
        meters: { $sum: { $ifNull: ['$qtyMeters', 0] } },
      },
    },
  ]);
}

/**
 * Orders that were issued or returned, with the fields the bill of material needs.
 * @param {string[]} orderIds
 */
function loadOrders(orderIds) {
  if (!orderIds.length) return Promise.resolve([]);
  return ProductionOrder.find({ _id: { $in: orderIds } })
    .select(
      'orderNumber orderDate buyer itemId targetQty lines.quantity lines.articleName lines.factoryCode lines.itemId lines.snapshot.fabricBom'
    )
    .lean();
}

/**
 * Keeps movement-only orders in the detail when the order document has gone.
 * @param {object[]} orders
 * @param {string[]} orderIds
 */
function withShells(orders, orderIds) {
  const known = new Set(orders.map((order) => String(order._id)));
  const shells = orderIds.filter((id) => !known.has(id)).map((id) => ({ _id: id, orderNumber: '', lines: [] }));
  return [...orders, ...shells];
}

/**
 * Closes one order-fabric bucket into a report row.
 * @param {string} orderId
 * @param {object} bucket
 * @param {Map<string, object>} meta
 */
function orderRow(orderId, bucket, meta) {
  const order = meta.get(orderId);
  const closed = closeUse(bucket);
  return {
    orderId,
    orderNumber: (order && order.orderNumber) || '',
    orderDate: isoDate(order && order.orderDate),
    buyer: (order && order.buyer) || '',
    fabricName: bucket.fabricName,
    fabricCatalogId: bucket.fabricCatalogId || '',
    missingBom: Boolean(bucket.missingBom),
    activeDays: [...bucket.activeDays].sort(),
    ...closed,
  };
}

/**
 * @param {Map<string, Map<string, object>>} orderBuckets
 * @param {Map<string, object>} meta
 */
function composeOrders(orderBuckets, meta) {
  const rows = [];
  orderBuckets.forEach((buckets, orderId) => {
    buckets.forEach((bucket) => rows.push(orderRow(orderId, bucket, meta)));
  });
  rows.sort(
    (a, b) =>
      b.varianceMeters - a.varianceMeters ||
      String(a.orderNumber).localeCompare(String(b.orderNumber)) ||
      a.fabricName.localeCompare(b.fabricName)
  );
  return rows;
}

/**
 * Rolls the order rows up to one card per fabric name.
 * @param {object[]} orderRows
 */
function composeFabrics(orderRows) {
  const grouped = new Map();
  orderRows.forEach((row) => {
    const key = nameKey(row.fabricName) || row.fabricCatalogId || 'unnamed';
    if (!grouped.has(key)) {
      grouped.set(key, {
        fabricName: row.fabricName,
        fabricCatalogId: row.fabricCatalogId || '',
        missingBom: true,
        orders: new Set(),
        bomMeters: 0,
        issuedMeters: 0,
        returnedMeters: 0,
        issuedRolls: 0,
        returnedRolls: 0,
      });
    }
    const bucket = grouped.get(key);
    if (!bucket.fabricCatalogId && row.fabricCatalogId) bucket.fabricCatalogId = row.fabricCatalogId;
    if (!row.missingBom) bucket.missingBom = false;
    bucket.orders.add(row.orderId);
    bucket.bomMeters += row.bomMeters;
    bucket.issuedMeters += row.issuedMeters;
    bucket.returnedMeters += row.returnedMeters;
    bucket.issuedRolls += row.issuedRolls;
    bucket.returnedRolls += row.returnedRolls;
  });
  return [...grouped.values()]
    .map((bucket) => {
      const closed = closeUse(bucket);
      return {
        fabricName: bucket.fabricName,
        fabricCatalogId: bucket.fabricCatalogId,
        missingBom: bucket.missingBom,
        orders: bucket.orders.size,
        ...closed,
      };
    })
    .sort((a, b) => b.varianceMeters - a.varianceMeters || a.fabricName.localeCompare(b.fabricName));
}

/**
 * Rounds the per-day activity used when a day bar is selected.
 * @param {Map<string, object>} activity
 */
function composeActivity(activity) {
  return [...activity.values()]
    .map((row) => ({
      date: row.date,
      orderId: row.orderId,
      fabricName: row.fabricName,
      issuedMeters: round3(row.issuedMeters),
      returnedMeters: round3(row.returnedMeters),
      issuedRolls: row.issuedRolls,
      returnedRolls: row.returnedRolls,
    }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.fabricName.localeCompare(b.fabricName));
}

/**
 * One bar per calendar day.
 * @param {object[]} activityRows
 */
function composeDays(activityRows) {
  const days = new Map();
  activityRows.forEach((row) => {
    if (!days.has(row.date)) {
      days.set(row.date, { date: row.date, issuedMeters: 0, returnedMeters: 0, issuedRolls: 0, orders: new Set() });
    }
    const day = days.get(row.date);
    day.issuedMeters += row.issuedMeters;
    day.returnedMeters += row.returnedMeters;
    day.issuedRolls += row.issuedRolls;
    day.orders.add(row.orderId);
  });
  return [...days.values()]
    .map((day) => ({
      date: day.date,
      issuedMeters: round3(day.issuedMeters),
      returnedMeters: round3(day.returnedMeters),
      consumedMeters: round3(day.issuedMeters - day.returnedMeters),
      issuedRolls: day.issuedRolls,
      orderCount: day.orders.size,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Metres issued to production orders against the fabric bill of material.
 * @param {object} [query]
 */
export async function consumptionReport(query = {}) {
  const clean = cleanQuery(query);
  const groups = await aggregateMovements(movementMatch(clean, {}), false);
  const orderIds = [...new Set(groups.map((group) => String(group._id.orderId)))];
  const orders = await loadOrders(orderIds);
  const products = await productsFor(orders);
  const orderBuckets = new Map();
  const activity = new Map();
  orders.forEach((order) => seedOrder(orderBuckets, order, products));
  groups.forEach((group) => applyGroup(orderBuckets, activity, group));
  const meta = new Map(orders.map((order) => [String(order._id), order]));
  const orderRows = composeOrders(orderBuckets, meta);
  const activityRows = composeActivity(activity);
  return {
    rangeLimited: Boolean(clean.from || clean.to),
    totals: orderRows.length ? composeTotals(orderRows) : zeroTotals(),
    fabrics: composeFabrics(orderRows),
    orders: orderRows,
    days: composeDays(activityRows),
    activity: activityRows,
  };
}

/**
 * Fabric clause for the roll list. Catalog id and the display name both count.
 * @param {string} fabric
 * @param {string} fabricId
 */
function fabricClause(fabric, fabricId) {
  const or = [];
  if (fabricId) or.push({ fabricCatalogId: fabricId });
  if (fabric && nameKey(fabric) === nameKey('Unnamed fabric')) or.push({ fabricName: { $in: ['', null] } });
  else if (fabric) {
    const escaped = fabric.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    or.push({ fabricName: { $regex: `^\\s*${escaped}\\s*$`, $options: 'i' } });
  }
  return or;
}

/**
 * Newest rolls in the selection. The panel caps the list and says when it is cut.
 * @param {object} match
 * @param {string} fabric
 * @param {string} fabricId
 * @param {Map<string, string>} numbers
 */
async function listMovements(match, fabric, fabricId, numbers) {
  const listMatch = { ...match };
  const clause = fabricClause(fabric, fabricId);
  if (clause.length) listMatch.$and = [{ $or: clause }];
  const rows = await StockMovement.find(listMatch)
    .select('kind createdAt entityId fabricName qtyMeters netWeight orderId')
    .sort({ createdAt: -1 })
    .limit(MOVEMENT_CAP + 1)
    .lean();
  return {
    truncated: rows.length > MOVEMENT_CAP,
    movements: rows.slice(0, MOVEMENT_CAP).map((row) => ({
      at: isoDate(row.createdAt),
      kind: row.kind,
      barcode: row.entityId || '',
      fabricName: labelOf(row.fabricName, 'Unnamed fabric'),
      meters: round3(row.qtyMeters),
      kg: round3(row.netWeight),
      orderId: String(row.orderId || ''),
      orderNumber: numbers.get(String(row.orderId || '')) || '',
    })),
  };
}

/**
 * Totals for the articles currently in the selection, including synthetic rows.
 * @param {object[]} articles
 */
function detailTotals(articles) {
  const rows = articles.flatMap((article) =>
    article.fabrics.map((fabric) => ({ ...fabric, orderId: article.orderId, fabricName: fabric.fabricName }))
  );
  return rows.length ? composeTotals(rows) : zeroTotals();
}

/**
 * Heading for whatever the user selected.
 * @param {object[]} orders
 * @param {object} query
 */
function detailTitle(orders, query) {
  const order = orders.find((item) => String(item._id) === String(query.orderId || ''));
  const parts = [];
  if (query.orderId) parts.push((order && order.orderNumber) || 'Unnumbered order');
  if (query.fabric) parts.push(query.fabric);
  if (query.day) parts.push(query.day);
  return parts.join(' · ') || 'Selection';
}

/**
 * Article lines, bill metres, and the rolls behind a fabric, order, or day.
 * @param {object} [query]
 */
export async function consumptionDetail(query = {}) {
  const clean = cleanQuery(query);
  const orderId = String(clean.orderId || '').trim();
  const fabric = String(clean.fabric || '').trim();
  const fabricId = String(clean.fabricId || '').trim();
  const day = String(clean.day || '').trim();
  if (!orderId && !fabric && !fabricId && !day) {
    return { title: '', note: '', totals: zeroTotals(), articles: [], movements: [], truncated: false };
  }
  if (orderId && !mongoose.Types.ObjectId.isValid(orderId)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Production order is invalid');
  }
  if (orderId) {
    const found = await ProductionOrder.findById(orderId).select('_id').lean();
    if (!found) throw new ApiError(httpStatus.NOT_FOUND, 'Production order not found');
  }

  const match = movementMatch(clean, { orderId, day });
  const groups = await aggregateMovements(match, true);
  const orderIds = orderId ? [orderId] : [...new Set(groups.map((group) => String(group._id.orderId)))];
  const loaded = await loadOrders(orderIds);
  const orders = withShells(loaded, orderIds);
  const products = await productsFor(orders);
  const articles = buildArticles(orders, products, groups, { fabric, fabricId });
  const numbers = new Map(orders.map((order) => [String(order._id), order.orderNumber || '']));
  const list = await listMovements(match, fabric, fabricId, numbers);
  const capped = !orderId && articles.length > 40;
  const note =
    clean.from || clean.to || day
      ? 'Issued metres follow this selection. BOM stays the full order requirement.'
      : 'Issued metres against the full bill of material.';
  return {
    title: detailTitle(orders, { orderId, fabric, day }),
    note: capped ? `${note} Showing the first 40 articles.` : note,
    totals: detailTotals(articles),
    articles: capped ? articles.slice(0, 40) : articles,
    movements: list.movements,
    truncated: list.truncated || capped,
  };
}
