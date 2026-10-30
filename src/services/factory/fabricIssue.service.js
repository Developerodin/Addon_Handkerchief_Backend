import httpStatus from 'http-status';
import mongoose from 'mongoose';
import ApiError from '../../utils/ApiError.js';
import { FabricLot, FabricRoll, StockMovement } from '../../models/store.model.js';
import { ProductionOrder, ProductionOrderLog } from '../../models/production.model.js';
import Product from '../../models/product.model.js';
import { writeOrderLog } from '../orderLog.service.js';
import { issueWholeBalance } from './rollBalance.js';
import { buildSnapshot, fabricLinesFromProduct, linesForRevision, realFabricBom } from '../production/orderSnapshot.js';

const OFF_RACK = new Set(['', 'floor', 'vendor', 'dispatched']);
const ISSUED = new Set(['issued', 'on-floor']);

/**
 * Latest scan that is still a basement rack. Floor and vendor are not racks.
 * @param {string} barcode
 */
async function rackLocation(barcode) {
  const row = await StockMovement.findOne({ entityType: 'roll', entityId: barcode }).sort({ createdAt: -1 });
  const location = row?.toLocation || '';
  return OFF_RACK.has(location) ? '' : location;
}

/**
 * Fabric lines frozen on the article, or the live bill of material when it was not pinned.
 * @param {object} order
 * @param {object} line
 */
async function fabricBomForLine(order, line) {
  if (line.pinId && line.snapshot) return realFabricBom(line.snapshot.fabricBom);
  if (line.snapshot?.fabricBom?.length) return realFabricBom(line.snapshot.fabricBom);
  const productId = line.itemId?._id || line.itemId;
  if (!productId) return realFabricBom(line.snapshot?.fabricBom);
  const product = await Product.findById(productId);
  if (!product) return realFabricBom(line.snapshot?.fabricBom);
  try {
    const version = await linesForRevision(product, line.revisionId || order.revisionId);
    const fromRevision = buildSnapshot(version.lines, product).fabricBom || [];
    return realFabricBom(fromRevision.length ? fromRevision : fabricLinesFromProduct(product));
  } catch (error) {
    if (error instanceof ApiError) throw error;
    const message = error instanceof Error ? error.message : 'Could not read the article fabric';
    throw new ApiError(httpStatus.BAD_REQUEST, message);
  }
}

/**
 * @param {object[]} bom
 * @param {string} bomLineId
 */
function findFabric(bom, bomLineId) {
  const wanted = String(bomLineId || '');
  return (bom || []).find((row) => {
    const id = String(row.bomLineId || '');
    if (id && id === wanted) return true;
    return !id && row.fabricName && row.fabricName === wanted;
  });
}

/**
 * Catalog id wins when both sides have one. Otherwise the fabric name must match.
 * @param {object} fabric
 * @param {object} roll
 */
function fabricsMatch(fabric, roll) {
  const bomId = String(fabric.fabricCatalogId || '');
  const rollId = String(roll.fabricId || '');
  if (bomId && rollId) return bomId === rollId;
  const bomName = String(fabric.fabricName || '').trim().toLowerCase();
  const rollName = String(roll.fabricName || '').trim().toLowerCase();
  return Boolean(bomName) && bomName === rollName;
}

/**
 * @param {object} fabric
 * @param {object} roll
 */
function mismatchMessage(fabric, roll) {
  const got = roll.fabricName || 'another fabric';
  const need = fabric.fabricName || 'a different fabric';
  return `This roll is ${got}. This line needs ${need}.`;
}

/**
 * @param {object} line
 * @param {object} fabric
 */
function issueRemarks(line, fabric) {
  const article = [line.factoryCode, line.articleName].map((part) => String(part || '').trim()).filter(Boolean).join(' ');
  const name = fabric?.fabricName || 'fabric';
  return article ? `${article} · ${name}` : name;
}

/**
 * Order, article, and fabric line for an issue or a return.
 * @param {string} orderId
 * @param {string} lineId
 * @param {string} bomLineId
 */
export async function loadArticleFabric(orderId, lineId, bomLineId) {
  if (!orderId) throw new ApiError(httpStatus.BAD_REQUEST, 'Production order is required');
  const order = await ProductionOrder.findById(orderId);
  if (!order) throw new ApiError(httpStatus.NOT_FOUND, 'Production order not found');
  if (!lineId || !mongoose.Types.ObjectId.isValid(lineId)) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Article not found on this order');
  }
  if (!bomLineId) throw new ApiError(httpStatus.BAD_REQUEST, 'Fabric line is required');
  const line = order.lines.id(lineId);
  if (!line) throw new ApiError(httpStatus.NOT_FOUND, 'Article not found on this order');
  const bom = await fabricBomForLine(order, line);
  const fabric = findFabric(bom, bomLineId);
  if (!fabric) throw new ApiError(httpStatus.BAD_REQUEST, 'This fabric is not on the article');
  return { order, line, fabric };
}

/**
 * Rejects a roll that is a different fabric from the selected line.
 * @param {object} fabric
 * @param {object} roll
 */
export function rollFitsFabric(fabric, roll) {
  if (fabricsMatch(fabric, roll)) return;
  throw new ApiError(httpStatus.BAD_REQUEST, mismatchMessage(fabric, roll));
}

/**
 * Issues one scanned roll. With an article line, the roll must match that fabric.
 * Without a line, the older order-only issue still moves the roll to the floor.
 * @param {object} body
 * @param {object | null} [user]
 */
export async function issueFabricRoll(body, user) {
  if (!body.orderId) throw new ApiError(httpStatus.BAD_REQUEST, 'Production order is required');
  const order = await ProductionOrder.findById(body.orderId);
  if (!order) throw new ApiError(httpStatus.NOT_FOUND, 'Production order not found');

  let line = null;
  let fabric = null;
  if (body.lineId) {
    if (!body.bomLineId) throw new ApiError(httpStatus.BAD_REQUEST, 'Fabric line is required');
    if (!mongoose.Types.ObjectId.isValid(body.lineId)) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Article not found on this order');
    }
    line = order.lines.id(body.lineId);
    if (!line) throw new ApiError(httpStatus.NOT_FOUND, 'Article not found on this order');
    if (line.fabricIssueStatus === 'completed') {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Fabric issue is complete for this article.');
    }
    const bom = await fabricBomForLine(order, line);
    fabric = findFabric(bom, body.bomLineId);
    if (!fabric) throw new ApiError(httpStatus.BAD_REQUEST, 'This fabric is not on the article');
  }

  const scanned = String(body.rollBarcode || '').trim();
  const roll = await FabricRoll.findOne({ $or: [{ barcode: scanned }, { rollCode: scanned }] });
  if (!roll) throw new ApiError(httpStatus.NOT_FOUND, 'Roll not found');
  if (fabric && !fabricsMatch(fabric, roll)) {
    throw new ApiError(httpStatus.BAD_REQUEST, mismatchMessage(fabric, roll));
  }
  if (ISSUED.has(roll.status)) throw new ApiError(httpStatus.BAD_REQUEST, 'This roll is already issued.');
  if (roll.qcStatus === 'rejected' || roll.qcStatus === 'held') {
    throw new ApiError(httpStatus.BAD_REQUEST, 'A rejected or held roll cannot be issued');
  }

  const lot = await FabricLot.findById(roll.lotId);
  if (!lot) throw new ApiError(httpStatus.NOT_FOUND, 'Lot not found');
  if (lot.qcStatus !== 'passed') throw new ApiError(httpStatus.BAD_REQUEST, 'This roll has not passed QC.');

  const fromLocation = await rackLocation(roll.barcode);
  if (!fromLocation) throw new ApiError(httpStatus.BAD_REQUEST, 'This roll is not on a rack.');

  if (body.eventId) {
    const existing = await StockMovement.findOne({ eventId: body.eventId });
    if (existing) return existing;
  }

  const movement = await issueWholeBalance(
    roll,
    {
      eventId: body.eventId,
      fromLocation,
      toLocation: 'floor',
      orderId: order.id,
      lineId: line ? String(line.id || line._id) : '',
      bomLineId: fabric ? String(fabric.bomLineId || body.bomLineId || '') : '',
      fabricCatalogId: fabric ? String(fabric.fabricCatalogId || '') : String(roll.fabricId || ''),
      fabricName: fabric?.fabricName || roll.fabricName || '',
    },
    user
  );
  await writeOrderLog(
    {
      action: 'issued',
      orderId: order.id,
      entityType: 'roll',
      entityCode: roll.barcode,
      fromLocation,
      toLocation: 'floor',
      remarks: line ? issueRemarks(line, fabric) : '',
    },
    user
  );
  return movement;
}

/**
 * Issue rows for one order, or the latest rows across orders.
 * @param {{ orderId?: string }} query
 */
export async function listFabricIssues(query) {
  const filter = { kind: 'issue', entityType: 'roll', orderId: { $exists: true, $ne: null } };
  if (query.orderId) {
    if (!mongoose.Types.ObjectId.isValid(query.orderId)) return { results: [] };
    filter.orderId = query.orderId;
  }
  const movements = await StockMovement.find(filter)
    .sort({ createdAt: -1 })
    .limit(query.orderId ? 200 : 500);
  const orderIds = [...new Set(movements.map((row) => String(row.orderId || '')).filter(Boolean))];
  const barcodes = movements.map((row) => row.entityId);
  const [orders, logs] = await Promise.all([
    ProductionOrder.find({ _id: { $in: orderIds } }).select('orderNumber lines'),
    ProductionOrderLog.find({ action: 'issued', entityCode: { $in: barcodes } }).sort({ at: 1 }),
  ]);
  const orderMap = new Map(orders.map((order) => [String(order.id), order]));
  const userByRoll = new Map();
  logs.forEach((log) => {
    userByRoll.set(`${String(log.orderId || '')}:${log.entityCode}`, log.userName || '');
  });

  return {
    results: movements.map((row) => {
      const order = orderMap.get(String(row.orderId));
      const line = (order?.lines || []).find((item) => String(item._id) === String(row.lineId));
      return {
        id: String(row.id),
        orderId: String(row.orderId),
        orderNumber: order?.orderNumber || '',
        lineId: row.lineId || '',
        bomLineId: row.bomLineId || '',
        fabricCatalogId: row.fabricCatalogId || '',
        fabricName: row.fabricName || '',
        barcode: row.entityId,
        netWeight: Number(row.netWeight) || 0,
        grossWeight: row.grossWeight == null ? null : Number(row.grossWeight),
        qtyMeters: row.qtyMeters == null ? null : Number(row.qtyMeters),
        scaleWeight: Number(row.scaleWeight) || 0,
        fromLocation: row.fromLocation || '',
        articleName: line?.articleName || '',
        factoryCode: line?.factoryCode || '',
        userName: row.userName || userByRoll.get(`${String(row.orderId)}:${row.entityId}`) || '',
        createdAt: row.createdAt,
      };
    }),
  };
}

/**
 * Marks one article's fabric issue complete. Reopen is not accepted.
 * @param {{ status?: string }} body
 * @param {{ orderId: string, lineId: string }} params
 * @param {object | null} [user]
 */
export async function completeFabricIssue(body, params, user) {
  if (body.status !== 'completed') throw new ApiError(httpStatus.BAD_REQUEST, 'Only completed is accepted');
  if (!mongoose.Types.ObjectId.isValid(params.orderId) || !mongoose.Types.ObjectId.isValid(params.lineId)) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Article not found on this order');
  }
  const order = await ProductionOrder.findById(params.orderId);
  if (!order) throw new ApiError(httpStatus.NOT_FOUND, 'Production order not found');
  const line = order.lines.id(params.lineId);
  if (!line) throw new ApiError(httpStatus.NOT_FOUND, 'Article not found on this order');
  if (line.fabricIssueStatus !== 'completed') {
    line.fabricIssueStatus = 'completed';
    await order.save();
    const article = [line.factoryCode, line.articleName].map((part) => String(part || '').trim()).filter(Boolean).join(' ');
    await writeOrderLog(
      {
        action: 'fabric-issue-complete',
        orderId: order.id,
        entityType: 'order',
        entityCode: article || String(line.id),
        remarks: article ? `Fabric issue complete for ${article}` : 'Fabric issue complete',
      },
      user
    );
  }
  return order.toJSON();
}

/**
 * Metres on the pinned bill of material. Issued rolls do not reduce this.
 * @param {object} order
 */
function requiredMetres(order) {
  let total = 0;
  for (const line of order.lines || []) {
    const qty = Number(line.quantity) || 0;
    for (const fabric of realFabricBom(line.snapshot?.fabricBom)) {
      const pinned = Number(fabric.requiredMetres);
      total += pinned > 0 ? pinned : Math.round((Number(fabric.metresPerPiece) || 0) * qty * 1000) / 1000;
    }
  }
  return Math.round(total * 1000) / 1000;
}

/**
 * Metres from the live bill of material when the line was not pinned.
 * A missing revision is skipped so one article cannot blank the orders list.
 * @param {object} order mongoose order
 */
async function liveMetres(order) {
  let total = 0;
  for (const line of order.lines || []) {
    let bom = [];
    try {
      bom = await fabricBomForLine(order, line);
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
    }
    const qty = Number(line.quantity) || 0;
    for (const fabric of bom) {
      total += Math.round((Number(fabric.metresPerPiece) || 0) * qty * 1000) / 1000;
    }
  }
  return Math.round(total * 1000) / 1000;
}

/**
 * Issued rolls, issued kilograms, and metres still on the bill of material.
 * @param {object} order JSON order
 * @param {{ rolls?: number, weightKg?: number }} stats
 * @param {number} metres
 */
function fabricIssueSummary(order, stats, metres) {
  const lines = order.lines || [];
  const rolls = Number(stats.rolls) || 0;
  const weightKg = Math.round((Number(stats.weightKg) || 0) * 100) / 100;
  let status = 'not-issued';
  if (lines.length > 0 && lines.every((line) => line.fabricIssueStatus === 'completed')) status = 'all-issued';
  else if (rolls > 0 || lines.some((line) => line.fabricIssueStatus === 'completed')) status = 'in-progress';
  return { status, rolls, weightKg, requiredMetres: metres };
}

/**
 * Adds fabric-issue totals onto each order in a page. One query for the page, not per row.
 * @param {object[]} docs production order documents
 */
export async function attachFabricIssue(docs) {
  const ids = docs.map((doc) => doc._id).filter(Boolean);
  const grouped = ids.length
    ? await StockMovement.aggregate([
        { $match: { kind: 'issue', entityType: 'roll', orderId: { $in: ids } } },
        {
          $group: {
            _id: '$orderId',
            rolls: { $sum: 1 },
            weightKg: { $sum: { $ifNull: ['$netWeight', 0] } },
          },
        },
      ])
    : [];
  const byId = new Map(grouped.map((row) => [String(row._id), row]));
  const results = [];
  for (const doc of docs) {
    const json = doc.toJSON();
    for (const line of json.lines || []) {
      if (!line.snapshot?.fabricBom) continue;
      line.snapshot.fabricBom = realFabricBom(line.snapshot.fabricBom);
    }
    const pinned = requiredMetres(json);
    const metres = pinned > 0 ? pinned : await liveMetres(doc);
    const hit = byId.get(String(json.id)) || { rolls: 0, weightKg: 0 };
    json.fabricIssue = fabricIssueSummary(json, hit, metres);
    results.push(json);
  }
  return results;
}
