import mongoose from 'mongoose';
import Product from '../../models/product.model.js';
import { fabricLinesFromProduct, realFabricBom } from '../production/orderSnapshot.js';
import { addUse, closeUse, labelOf, nameKey } from './consumptionMath.js';

/* Accumulators add metres onto the bucket they were given. */
/* eslint-disable no-param-reassign */

/**
 * Catalog id stored as a string, an ObjectId, or a populated document.
 * @param {unknown} value
 */
export function idText(value) {
  if (!value) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'object' && value._id) return String(value._id);
  if (typeof value === 'object' && value.id) return String(value.id);
  return String(value);
}

/**
 * Old orders have no lines. The header still carries the article and the quantity.
 * @param {object} order
 */
export function articleLines(order) {
  if (order && order.lines && order.lines.length) return order.lines;
  if (!order || (!order.itemId && !order.targetQty)) return [];
  return [
    {
      _id: order._id,
      itemId: order.itemId,
      articleName: '',
      factoryCode: '',
      quantity: order.targetQty,
      snapshot: null,
    },
  ];
}

/**
 * One fabric identity used for matching issues to the bill of material.
 * @param {object} row
 */
export function normalizeFabric(row) {
  const source = row || {};
  const catalog = source.fabricCatalogId;
  const catalogName = catalog && typeof catalog === 'object' ? catalog.name : '';
  const metres = source.metresPerPiece != null ? source.metresPerPiece : source.quantity;
  return {
    bomLineId: String(source.bomLineId || '').trim(),
    fabricCatalogId: idText(catalog),
    fabricName: labelOf(source.fabricName || catalogName, 'Unnamed fabric'),
    metresPerPiece: Number(metres) || 0,
  };
}

/**
 * Fabric lines frozen on the article, or the live product bill when nothing was pinned.
 * @param {object} line
 * @param {Map<string, object>} products
 */
export function fabricsForLine(line, products) {
  const snapshot = line && line.snapshot;
  const pinned = realFabricBom(snapshot && snapshot.fabricBom).map(normalizeFabric);
  if (pinned.length) return pinned;
  const product = products.get(idText(line && line.itemId));
  if (!product) return [];
  return fabricLinesFromProduct(product).map(normalizeFabric);
}

/**
 * Loads products only for articles whose snapshot has no fabric lines.
 * @param {object[]} orders
 */
export async function productsFor(orders) {
  const ids = new Set();
  orders.forEach((order) => {
    articleLines(order).forEach((line) => {
      const { snapshot } = line;
      if (realFabricBom(snapshot && snapshot.fabricBom).length) return;
      const id = idText(line.itemId);
      if (id && mongoose.Types.ObjectId.isValid(id)) ids.add(id);
    });
  });
  if (!ids.size) return new Map();
  const products = await Product.find({ _id: { $in: [...ids] } })
    .select('bom')
    .populate('bom.fabricCatalogId', 'name')
    .lean();
  return new Map(products.map((product) => [String(product._id), product]));
}

/**
 * Stable bucket key. Catalog id wins so the same cloth is not split by spelling.
 * @param {object} fabric
 */
function bucketKey(fabric) {
  if (fabric.fabricCatalogId) return `id:${fabric.fabricCatalogId}`;
  return `name:${nameKey(fabric.fabricName)}`;
}

/**
 * Finds a fabric bucket by bill line, catalog id, or name.
 * @param {Map<string, object>} buckets
 * @param {object} fabric
 */
export function findBucket(buckets, fabric) {
  const id = String(fabric.fabricCatalogId || '').trim();
  const bom = String(fabric.bomLineId || '').trim();
  const name = nameKey(fabric.fabricName);
  const unnamed = nameKey('Unnamed fabric');
  const matches = (bucket) => {
    if (bom && bucket.bomLineIds.includes(bom)) return true;
    if (id && bucket.fabricCatalogId && bucket.fabricCatalogId === id) return true;
    return Boolean(name && name !== unnamed && nameKey(bucket.fabricName) === name);
  };
  return Array.from(buckets.values()).find(matches) || null;
}

/**
 * Empty counters for one order fabric.
 * @param {object} fabric
 * @param {boolean} missingBom
 */
function freshBucket(fabric, missingBom) {
  return {
    fabricName: fabric.fabricName,
    fabricCatalogId: fabric.fabricCatalogId || '',
    bomLineIds: fabric.bomLineId ? [fabric.bomLineId] : [],
    bomMeters: 0,
    metresPerPiece: Number(fabric.metresPerPiece) || 0,
    missingBom,
    activeDays: new Set(),
    issuedMeters: 0,
    returnedMeters: 0,
    issuedRolls: 0,
    returnedRolls: 0,
  };
}

/**
 * @param {Map<string, Map<string, object>>} orderBuckets
 * @param {string} orderId
 */
function bucketsFor(orderBuckets, orderId) {
  if (!orderBuckets.has(orderId)) orderBuckets.set(orderId, new Map());
  return orderBuckets.get(orderId);
}

/**
 * Adds required metres for one article fabric. Later issues land on this bucket.
 * @param {Map<string, Map<string, object>>} orderBuckets
 * @param {string} orderId
 * @param {object} fabric
 * @param {number} metres
 */
export function placeBom(orderBuckets, orderId, fabric, metres) {
  const buckets = bucketsFor(orderBuckets, orderId);
  const found = findBucket(buckets, fabric);
  if (found) {
    found.bomMeters += metres;
    found.missingBom = false;
    if (!found.fabricCatalogId && fabric.fabricCatalogId) found.fabricCatalogId = fabric.fabricCatalogId;
    if (fabric.bomLineId && !found.bomLineIds.includes(fabric.bomLineId)) found.bomLineIds.push(fabric.bomLineId);
    if (!found.metresPerPiece && fabric.metresPerPiece) found.metresPerPiece = fabric.metresPerPiece;
    return;
  }
  const bucket = freshBucket(fabric, false);
  bucket.bomMeters = metres;
  buckets.set(bucketKey(fabric), bucket);
}

/**
 * Seeds every fabric on the order, including fabrics that were never issued.
 * @param {Map<string, Map<string, object>>} orderBuckets
 * @param {object} order
 * @param {Map<string, object>} products
 */
export function seedOrder(orderBuckets, order, products) {
  const orderId = String(order._id);
  articleLines(order).forEach((line) => {
    const pieces = Number(line.quantity) || 0;
    fabricsForLine(line, products).forEach((fabric) => {
      placeBom(orderBuckets, orderId, fabric, pieces * fabric.metresPerPiece);
    });
  });
}

/**
 * Records one day's metres against the fabric name the report will display.
 * @param {Map<string, object>} activity
 * @param {object} bucket
 * @param {string} orderId
 * @param {string} day
 * @param {object} group
 */
function rememberDay(activity, bucket, orderId, day, group) {
  bucket.activeDays.add(day);
  const key = `${day}::${orderId}::${bucket.fabricName}`;
  if (!activity.has(key)) {
    activity.set(key, {
      date: day,
      orderId,
      fabricName: bucket.fabricName,
      issuedMeters: 0,
      returnedMeters: 0,
      issuedRolls: 0,
      returnedRolls: 0,
    });
  }
  addUse(activity.get(key), group._id.kind, group);
}

/**
 * Adds an aggregated issue or return onto the matching bill line.
 * @param {Map<string, Map<string, object>>} orderBuckets
 * @param {Map<string, object>} activity
 * @param {object} group
 */
export function applyGroup(orderBuckets, activity, group) {
  const orderId = String(group._id.orderId);
  const fabric = normalizeFabric({
    fabricCatalogId: group._id.fabricCatalogId,
    fabricName: group._id.fabric,
    bomLineId: group._id.bomLineId,
  });
  const buckets = bucketsFor(orderBuckets, orderId);
  let bucket = findBucket(buckets, fabric);
  if (!bucket) {
    bucket = freshBucket(fabric, true);
    buckets.set(bucketKey(fabric), bucket);
  }
  addUse(bucket, group._id.kind, group);
  if (group._id.day) rememberDay(activity, bucket, orderId, group._id.day, group);
}

/**
 * One article fabric row before metres are rounded.
 * @param {object} fabric
 * @param {number} pieces
 * @param {boolean} missingBom
 */
function blankFabric(fabric, pieces, missingBom) {
  return {
    fabricName: fabric.fabricName,
    fabricCatalogId: fabric.fabricCatalogId || '',
    bomLineIds: fabric.bomLineId ? [fabric.bomLineId] : [],
    metresPerPiece: Number(fabric.metresPerPiece) || 0,
    pieces,
    bomMeters: missingBom ? 0 : pieces * (Number(fabric.metresPerPiece) || 0),
    missingBom,
    issuedMeters: 0,
    returnedMeters: 0,
    issuedRolls: 0,
    returnedRolls: 0,
  };
}

/**
 * Selected fabric name or catalog id. An empty filter keeps every fabric.
 * @param {object} fabric
 * @param {{ fabric?: string, fabricId?: string }} filter
 */
function fabricVisible(fabric, filter) {
  const source = filter || {};
  const name = String(source.fabric || '').trim();
  const id = String(source.fabricId || '').trim();
  if (!name && !id) return true;
  if (id && fabric.fabricCatalogId === id) return true;
  return Boolean(name) && nameKey(fabric.fabricName) === nameKey(name);
}

/**
 * Puts a movement group on one article, or on a synthetic row when it cannot be tied.
 * @param {object[]} articles
 * @param {Map<string, object>} synthetics
 * @param {object} group
 */
function attributeGroup(articles, synthetics, group) {
  const orderId = String(group._id.orderId);
  const fabric = normalizeFabric({
    fabricCatalogId: group._id.fabricCatalogId,
    fabricName: group._id.fabric,
    bomLineId: group._id.bomLineId,
  });
  const orderArticles = articles.filter((article) => article.orderId === orderId);
  const lineId = String(group._id.lineId || '');
  const hosts = lineId ? orderArticles.filter((article) => article.lineId === lineId) : orderArticles;
  const pool = hosts.length ? hosts : orderArticles;
  const hits = pool
    .map((article) => findBucket(new Map(article.fabrics.map((row, index) => [String(index), row])), fabric))
    .filter(Boolean);
  if (hits.length === 1) {
    addUse(hits[0], group._id.kind, group);
    return;
  }
  const untied = hits.length > 1;
  const key = `${orderId}::${untied ? 'untied' : 'missing'}::${bucketKey(fabric)}`;
  if (!synthetics.has(key)) {
    synthetics.set(key, {
      orderId,
      orderNumber: (orderArticles[0] && orderArticles[0].orderNumber) || '',
      lineId: '',
      articleName: untied ? 'Not tied to an article' : 'Not on the BOM',
      factoryCode: '',
      pieces: 0,
      fabrics: [blankFabric(fabric, 0, !untied)],
    });
  }
  addUse(synthetics.get(key).fabrics[0], group._id.kind, group);
}

/**
 * Rounds one article fabric and drops the matching keys the screen does not need.
 * @param {object} fabric
 */
function closeFabric(fabric) {
  const closed = closeUse(fabric);
  return {
    fabricName: fabric.fabricName,
    fabricCatalogId: fabric.fabricCatalogId,
    metresPerPiece: Number(fabric.metresPerPiece) || 0,
    pieces: fabric.pieces,
    missingBom: Boolean(fabric.missingBom),
    ...closed,
  };
}

/**
 * Article lines for the detail panel, including a fabric that was not issued.
 * @param {object[]} orders
 * @param {Map<string, object>} products
 * @param {object[]} groups
 * @param {{ fabric?: string, fabricId?: string }} filter
 */
export function buildArticles(orders, products, groups, filter) {
  const articles = [];
  orders.forEach((order) => {
    articleLines(order).forEach((line) => {
      const pieces = Number(line.quantity) || 0;
      const fabrics = fabricsForLine(line, products).map((fabric) => blankFabric(fabric, pieces, false));
      if (!fabrics.length) return;
      articles.push({
        orderId: String(order._id),
        orderNumber: order.orderNumber || '',
        lineId: String(line._id || ''),
        articleName: labelOf(line.articleName, 'Article'),
        factoryCode: line.factoryCode || '',
        pieces,
        fabrics,
      });
    });
  });

  const synthetics = new Map();
  groups.forEach((group) => attributeGroup(articles, synthetics, group));

  return [...articles, ...synthetics.values()]
    .map((article) => ({
      ...article,
      fabrics: article.fabrics.filter((fabric) => fabricVisible(fabric, filter)).map(closeFabric),
    }))
    .filter((article) => article.fabrics.length);
}
