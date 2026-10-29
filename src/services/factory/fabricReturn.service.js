import httpStatus from 'http-status';
import mongoose from 'mongoose';
import ApiError from '../../utils/ApiError.js';
import { FabricRoll, StockMovement } from '../../models/store.model.js';
import { ProductionOrder, ProductionOrderLog } from '../../models/production.model.js';
import { writeOrderLog } from '../orderLog.service.js';
import { loadArticleFabric, rollFitsFabric } from './fabricIssue.service.js';
import { openIssueMovement, returnRollBalance } from './rollBalance.js';
import { findRack } from './rackSlots.service.js';

/**
 * Returns one issued roll to a scanned rack for this order and article.
 * The leftover becomes the current balance. Received weights stay as they were.
 * @param {object} body
 * @param {object | null} [user]
 */
export async function returnFabricRoll(body, user) {
  const { order, line, fabric } = await loadArticleFabric(body.orderId, body.lineId, body.bomLineId);
  const scanned = String(body.rollBarcode || '').trim();
  const roll = await FabricRoll.findOne({ $or: [{ barcode: scanned }, { rollCode: scanned }] });
  if (!roll) throw new ApiError(httpStatus.NOT_FOUND, 'Roll not found');
  rollFitsFabric(fabric, roll);

  const issue = await openIssueMovement(roll.barcode);
  if (!issue) throw new ApiError(httpStatus.BAD_REQUEST, 'This roll has no open issue');
  if (issue.orderId && String(issue.orderId) !== String(order.id)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'This roll was issued to another order');
  }
  if (issue.lineId && String(issue.lineId) !== String(line.id || line._id)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'This roll was issued to another article');
  }

  const rack = await findRack(body.rackCode);
  if (!rack) throw new ApiError(httpStatus.NOT_FOUND, 'Rack not found. Scan a rack barcode that exists.');

  const lineId = String(line.id || line._id);
  const { movement, fromLocation } = await returnRollBalance(
    roll,
    {
      ...body,
      rackCode: rack.code,
      orderId: order.id,
      lineId,
      bomLineId: String(fabric.bomLineId || body.bomLineId || ''),
      fabricCatalogId: String(fabric.fabricCatalogId || ''),
      fabricName: fabric.fabricName || roll.fabricName || '',
    },
    user
  );
  const article = [line.factoryCode, line.articleName].map((part) => String(part || '').trim()).filter(Boolean).join(' ');
  await writeOrderLog(
    {
      action: 'returned',
      orderId: order.id,
      entityType: 'roll',
      entityCode: roll.barcode,
      fromLocation,
      toLocation: rack.code,
      remarks: article ? `${article} · ${fabric.fabricName || 'fabric'}` : fabric.fabricName || '',
    },
    user
  );
  return movement;
}

/**
 * Return rows for one order, or the latest rows across orders.
 * @param {{ orderId?: string }} query
 */
export async function listFabricReturns(query) {
  const filter = { kind: 'return-to-rack', entityType: 'roll', orderId: { $exists: true, $ne: null } };
  if (query.orderId) {
    if (!mongoose.Types.ObjectId.isValid(query.orderId)) return { results: [] };
    filter.orderId = query.orderId;
  }
  const movements = await StockMovement.find(filter).sort({ createdAt: -1 }).limit(query.orderId ? 200 : 500);
  const orderIds = [...new Set(movements.map((row) => String(row.orderId || '')).filter(Boolean))];
  const barcodes = movements.map((row) => row.entityId);
  const [orders, logs] = await Promise.all([
    ProductionOrder.find({ _id: { $in: orderIds } }).select('orderNumber lines'),
    ProductionOrderLog.find({ action: 'returned', entityCode: { $in: barcodes } }).sort({ at: 1 }),
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
        fromLocation: row.fromLocation || '',
        rackCode: row.toLocation || '',
        articleName: line?.articleName || '',
        factoryCode: line?.factoryCode || '',
        userName: row.userName || userByRoll.get(`${String(row.orderId)}:${row.entityId}`) || '',
        createdAt: row.createdAt,
      };
    }),
  };
}
