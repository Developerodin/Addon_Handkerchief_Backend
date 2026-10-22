import Product from '../../models/product.model.js';
import { ProductionOrder } from '../../models/production.model.js';
import { pageOf } from '../factoryLists.service.js';
import { buildSnapshot, fabricAvailability, linesForRevision } from './orderSnapshot.js';

/**
 * Counts for the four tiles. Amended orders sit with in progress.
 */
export const orderStatusCounts = async () => {
  const [pending, inProgress, completed, onHold] = await Promise.all([
    ProductionOrder.countDocuments({ status: { $in: ['pending', 'released'] } }),
    ProductionOrder.countDocuments({ status: { $in: ['in-progress', 'amended'] } }),
    ProductionOrder.countDocuments({ status: 'closed' }),
    ProductionOrder.countDocuments({ status: 'on-hold' }),
  ]);
  return { pending, inProgress, completed, onHold };
};

/**
 * Highest completed quantity on the steps that actually moved.
 * @param {object} order
 * @param {object} line
 */
const progressOf = (order, line) => {
  const lineMoved = (line.floors || []).some((step) => step.completedQty);
  const steps = lineMoved ? line.floors : order.floors || [];
  const done = steps.reduce((max, step) => Math.max(max, step.completedQty || 0), 0);
  const target = line.quantity || order.targetQty || 0;
  return target ? Math.min(100, Math.round((done / target) * 100)) : 0;
};

/**
 * One row per item line, including old orders that only have a header.
 * @param {object} query
 */
export const listArticleLines = async (query) => {
  const filter = {};
  if (query.search) {
    const pattern = new RegExp(String(query.search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [
      { orderNumber: pattern },
      { orderNote: pattern },
      { 'lines.factoryCode': pattern },
      { 'lines.articleName': pattern },
    ];
  }
  const page = await pageOf(ProductionOrder, filter, { ...query, limit: query.limit || '100' });
  const rows = [];
  for (const order of page.results) {
    const json = order.toJSON();
    for (const line of json.lines || []) {
      const text = `${line.factoryCode || ''} ${line.articleName || ''} ${json.orderNumber || ''} ${json.orderNote || ''}`;
      if (query.search && !text.toLowerCase().includes(String(query.search).toLowerCase())) continue;
      rows.push({
        id: `${json.id}:${line.id}`,
        lineId: line.id,
        orderId: json.id,
        orderNumber: json.orderNumber,
        orderNote: json.orderNote || '',
        articleName: line.articleName || '',
        factoryCode: line.factoryCode || '',
        quantity: line.quantity,
        status: json.status,
        priority: line.priority || json.priority,
        progress: progressOf(json, line),
        revisionId: line.revisionId || json.revisionId,
      });
    }
  }
  return { results: rows, page: page.page, limit: page.limit, totalPages: page.totalPages, totalResults: rows.length };
};

/**
 * Fabric metres the order needs against store metres still in the basement.
 * @param {object} query
 */
export const fabricEstimation = async (query) => {
  const filter = { status: { $ne: 'closed' } };
  if (query.orderId) filter._id = query.orderId;
  const orders = await ProductionOrder.find(filter).sort({ createdAt: -1 }).limit(200);
  const results = [];
  for (const order of orders) {
    const json = order.toJSON();
    for (const line of json.lines || []) {
      let snapshot = line.snapshot;
      if (!line.pinId) {
        const product = line.itemId ? await Product.findById(line.itemId) : null;
        if (product) {
          const version = await linesForRevision(product, line.revisionId || json.revisionId);
          snapshot = buildSnapshot(version.lines, product);
        }
      }
      if (!snapshot) snapshot = { fabricBom: [] };
      const fabric = await fabricAvailability(snapshot.fabricBom);
      const fabrics = fabric.map((row) => {
        const requiredMetres = Math.round((row.metresPerPiece || 0) * (line.quantity || 0) * 1000) / 1000;
        return {
          ...row,
          requiredMetres,
          shortageMetres: Math.max(0, Math.round((requiredMetres - row.onHandMetres) * 1000) / 1000),
        };
      });
      results.push({
        orderId: json.id,
        orderNumber: json.orderNumber,
        lineId: line.id,
        factoryCode: line.factoryCode,
        articleName: line.articleName,
        quantity: line.quantity,
        pinned: Boolean(line.pinId),
        fabrics,
      });
    }
  }
  return { results };
};

/**
 * Quantity received on a floor and not yet transferred.
 */
export const upcomingByFloor = async () => {
  const orders = await ProductionOrder.find({ status: { $in: ['released', 'in-progress', 'amended', 'on-hold'] } }).limit(500);
  const floors = new Map();
  for (const order of orders) {
    const json = order.toJSON();
    const steps = json.lines.some((line) => (line.floors || []).length)
      ? json.lines.flatMap((line) => line.floors || [])
      : json.floors || [];
    for (const step of steps) {
      const waiting = Math.max(0, (step.receivedQty || 0) - (step.transferredQty || 0));
      if (!waiting) continue;
      const key = step.floor || step.name;
      const current = floors.get(key) || { floor: key, name: step.name || key, quantity: 0, orders: 0 };
      current.quantity += waiting;
      current.orders += 1;
      floors.set(key, current);
    }
  }
  return { results: [...floors.values()] };
};
