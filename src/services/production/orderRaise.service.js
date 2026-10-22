import httpStatus from 'http-status';
import mongoose from 'mongoose';
import ApiError from '../../utils/ApiError.js';
import Product from '../../models/product.model.js';
import { FloorCompletion, ProductionOrder, ProductionOrderLog } from '../../models/production.model.js';
import { writeOrderLog } from '../orderLog.service.js';
import { snapshotFloors } from '../production.service.js';
import { createPin } from '../versioning/pin.service.js';
import { allocateOrderNumber } from './orderNumber.js';
import { buildSnapshot, fabricAvailability, linesForRevision, routeOf, scopeIdFor } from './orderSnapshot.js';

const PRIORITIES = new Set(['Urgent', 'High', 'Medium', 'Low']);

/**
 * @param {object | null | undefined} user
 */
const actorId = (user) => {
  const id = user && (user._id || user.id);
  return id && mongoose.Types.ObjectId.isValid(id) ? id : null;
};

/**
 * @param {object} input
 */
const draftLine = async (input) => {
  const product = await Product.findById(input.itemId);
  if (!product) throw new ApiError(httpStatus.BAD_REQUEST, 'Item not found');
  const quantity = Number(input.quantity);
  if (!quantity || quantity < 1) throw new ApiError(httpStatus.BAD_REQUEST, 'Each line needs a quantity');
  const pieces = Number(input.piecesPerCut) === 4 || Number(product.piecesPerCut) === 4 ? 4 : 3;
  if (input.piecesPerCut && Number(input.piecesPerCut) !== 3 && Number(input.piecesPerCut) !== 4) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Pieces per cut must be 3 or 4');
  }
  return {
    itemId: product.id,
    articleName: product.articleName || product.name || '',
    factoryCode: product.factoryCode || '',
    productionType: routeOf(product.productionType),
    piecesPerCut: Number(input.piecesPerCut) === 3 || Number(input.piecesPerCut) === 4 ? Number(input.piecesPerCut) : pieces,
    quantity,
    priority: PRIORITIES.has(input.priority) ? input.priority : 'Medium',
    remarks: input.remarks || '',
    revisionId: input.revisionId || '',
    scopeId: scopeIdFor(product),
  };
};

/**
 * Copies the first line onto the header so older floor screens still see one order.
 * @param {object} order
 * @param {object[]} lines
 * @param {object} body
 */
const applyHeader = (order, lines, body) => {
  const first = lines[0];
  order.itemId = first.itemId;
  order.productionType = first.productionType;
  order.revisionId = first.revisionId || order.revisionId || '';
  order.targetQty = lines.reduce((sum, line) => sum + line.quantity, 0);
  order.priority = PRIORITIES.has(body.priority) ? body.priority : first.priority;
  if (body.orderNote !== undefined) order.orderNote = body.orderNote || '';
  if (body.buyer !== undefined) order.buyer = body.buyer || '';
  if (body.requiredBy !== undefined) order.requiredBy = body.requiredBy || null;
  if (body.clientOrderId !== undefined) order.clientOrderId = body.clientOrderId || null;
};

/**
 * Saves a draft. Nothing is pinned.
 * @param {object} body
 * @param {object | null} [user]
 */
export const createDraft = async (body, user) => {
  if (!Array.isArray(body.lines) || !body.lines.length) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Add at least one item');
  }
  const lines = [];
  for (const input of body.lines) {
    lines.push(await draftLine(input));
  }
  const order = new ProductionOrder({
    orderNumber: await allocateOrderNumber(),
    orderDate: new Date(),
    status: 'pending',
    lines,
    floors: [],
    segments: [],
  });
  applyHeader(order, lines, body);
  await order.save();
  await writeOrderLog(
    {
      action: 'order-created',
      orderId: order.id,
      entityType: 'order',
      entityCode: order.orderNumber,
      quantity: order.targetQty,
      remarks: order.orderNote || '',
    },
    user
  );
  for (const line of order.lines) {
    await writeOrderLog(
      {
        action: 'line-added',
        orderId: order.id,
        entityType: 'order',
        entityCode: line.factoryCode || line.articleName,
        quantity: line.quantity,
        remarks: line.remarks || '',
      },
      user
    );
  }
  return order;
};

/**
 * Old orders have no stored lines. The first save that picks an article writes those lines.
 * Header floors and segments stay on that line so floor qty is not dropped.
 * @param {object} order
 * @param {object} body
 */
const attachMissingLines = async (order, body) => {
  if (order.lines.length) return;
  if (!Array.isArray(body.lines) || !body.lines.some((row) => row.itemId)) return;
  const lines = [];
  for (const input of body.lines) {
    if (!input.itemId) continue;
    lines.push(await draftLine({ ...input, revisionId: input.revisionId || order.revisionId || '' }));
  }
  if (lines.length === 1) {
    lines[0].segments = order.segments || [];
    lines[0].floors = order.floors || [];
  }
  order.lines = lines;
  applyHeader(order, lines, body);
};

/**
 * Draft lines can change. A released line with floor work cannot.
 * @param {string} orderId
 * @param {object} body
 * @param {object | null} [user]
 */
export const updateOrder = async (orderId, body, user) => {
  const order = await ProductionOrder.findById(orderId);
  if (!order) throw new ApiError(httpStatus.NOT_FOUND, 'Production order not found');
  if (order.status === 'closed') throw new ApiError(httpStatus.BAD_REQUEST, 'A completed order cannot be edited');
  if (order.status === 'pending') {
    if (!Array.isArray(body.lines) || !body.lines.length) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Add at least one item');
    }
    const lines = [];
    for (const input of body.lines) lines.push(await draftLine(input));
    order.lines = lines;
    applyHeader(order, lines, body);
    await order.save();
    await writeOrderLog(
      {
        action: 'order-updated',
        orderId: order.id,
        entityType: 'order',
        entityCode: order.orderNumber,
        quantity: order.targetQty,
        remarks: order.orderNote || '',
      },
      user
    );
    return order;
  }
  await attachMissingLines(order, body);
  if (body.priority && PRIORITIES.has(body.priority)) order.priority = body.priority;
  if (body.orderNote !== undefined) order.orderNote = body.orderNote || '';
  if (body.buyer !== undefined) order.buyer = body.buyer || '';
  if (body.requiredBy !== undefined) order.requiredBy = body.requiredBy || null;
  const completions = await FloorCompletion.find({ orderId: order.id }).select('lineId');
  const locked = new Set(completions.map((row) => String(row.lineId || '')).filter(Boolean));
  const lockSingle = completions.length > 0 && order.lines.length <= 1;
  if (Array.isArray(body.lines)) {
    for (const input of body.lines) {
      const line = input.id ? order.lines.id(input.id) : null;
      if (!line) continue;
      if (input.itemId && String(input.itemId) !== String(line.itemId)) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'Released items cannot be swapped');
      }
      if (input.quantity && Number(input.quantity) !== line.quantity) {
        throw new ApiError(httpStatus.BAD_REQUEST, 'Released quantity changes by amendment');
      }
      if (lockSingle || locked.has(String(line.id))) continue;
      if (input.priority && PRIORITIES.has(input.priority)) line.priority = input.priority;
      if (input.remarks !== undefined) line.remarks = input.remarks || '';
    }
  }
  await order.save();
  await writeOrderLog(
    {
      action: 'order-updated',
      orderId: order.id,
      entityType: 'order',
      entityCode: order.orderNumber,
      quantity: order.targetQty,
      remarks: '',
    },
    user
  );
  return order;
};

/**
 * Builds the pin snapshot and basement-roll check. confirm false does not save.
 * @param {string} orderId
 * @param {{ confirm?: boolean }} body
 * @param {object | null} [user]
 */
export const releaseDraft = async (orderId, body, user) => {
  const order = await ProductionOrder.findById(orderId);
  if (!order) throw new ApiError(httpStatus.NOT_FOUND, 'Production order not found');
  if (order.status !== 'pending') throw new ApiError(httpStatus.BAD_REQUEST, 'Only a draft can be released');
  if (!order.lines.length) throw new ApiError(httpStatus.BAD_REQUEST, 'Add at least one item');
  const preview = [];
  for (const line of order.lines) {
    if (!line.revisionId) throw new ApiError(httpStatus.BAD_REQUEST, 'Each item needs a published revision');
    const product = await Product.findById(line.itemId);
    if (!product) throw new ApiError(httpStatus.BAD_REQUEST, 'Item not found');
    const version = await linesForRevision(product, line.revisionId);
    const snapshot = buildSnapshot(version.lines, product);
    const fabric = await fabricAvailability(snapshot.fabricBom);
    preview.push({
      id: line.id,
      articleName: line.articleName,
      factoryCode: line.factoryCode,
      revisionId: line.revisionId,
      quantity: line.quantity,
      snapshot,
      fabric,
      scopeId: version.scopeId,
    });
  }
  if (!body.confirm) return { preview: true, lines: preview, orderNumber: order.orderNumber };

  for (const row of preview) {
    const line = order.lines.id(row.id);
    line.snapshot = row.snapshot;
    line.piecesPerCut = row.snapshot.piecesPerCut;
    line.productionType = routeOf(row.snapshot.route);
    line.scopeId = row.scopeId;
    const floors = await snapshotFloors({ itemId: line.itemId, productionType: line.productionType });
    if (floors[0]) floors[0].receivedQty = line.quantity;
    line.floors = floors;
    line.segments = [{ revisionId: line.revisionId, qty: line.quantity, completedQty: 0 }];
    if (mongoose.Types.ObjectId.isValid(line.revisionId)) {
      const pin = await createPin({
        scopeId: row.scopeId,
        revisionId: line.revisionId,
        kind: 'release',
        quantity: line.quantity,
        completedQuantity: 0,
        note: order.orderNumber,
        actorId: actorId(user),
      });
      line.pinId = pin.pin.id;
    }
  }
  const first = order.lines[0];
  order.floors = first.floors.map((step) => ({
    processId: step.processId,
    name: step.name,
    floor: step.floor,
    sortOrder: step.sortOrder,
    receivedQty: step.receivedQty,
    completedQty: step.completedQty,
    transferredQty: step.transferredQty,
  }));
  order.segments = first.segments.map((segment) => ({
    revisionId: segment.revisionId,
    qty: segment.qty,
    completedQty: segment.completedQty,
  }));
  order.currentFloor = order.floors[0]?.floor || '';
  order.productionType = first.productionType;
  order.revisionId = first.revisionId;
  order.itemId = first.itemId;
  order.targetQty = order.lines.reduce((sum, line) => sum + line.quantity, 0);
  order.status = 'released';
  await order.save();
  await writeOrderLog(
    {
      action: 'released',
      orderId: order.id,
      entityType: 'order',
      entityCode: order.orderNumber,
      quantity: order.targetQty,
      remarks: first.revisionId,
    },
    user
  );
  return order;
};

/**
 * Parks a released order, or puts it back when hold is false.
 * @param {string} orderId
 * @param {{ hold?: boolean }} body
 * @param {object | null} [user]
 */
export const holdOrder = async (orderId, body, user) => {
  const order = await ProductionOrder.findById(orderId);
  if (!order) throw new ApiError(httpStatus.NOT_FOUND, 'Production order not found');
  if (order.status === 'pending' || order.status === 'closed') {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Only a released order can be put on hold');
  }
  if (body.hold === false) {
    const done = await FloorCompletion.exists({ orderId: order.id });
    order.status = done ? 'in-progress' : 'released';
  } else {
    order.status = 'on-hold';
  }
  await order.save();
  await writeOrderLog(
    {
      action: 'on-hold',
      orderId: order.id,
      entityType: 'order',
      entityCode: order.orderNumber,
      quantity: order.targetQty,
      remarks: order.status,
    },
    user
  );
  return order;
};

/**
 * Deletes a draft that has not had fabric issued or floor work.
 * @param {string} orderId
 */
export const deleteDraft = async (orderId) => {
  const order = await ProductionOrder.findById(orderId);
  if (!order) throw new ApiError(httpStatus.NOT_FOUND, 'Production order not found');
  if (order.status !== 'pending') throw new ApiError(httpStatus.BAD_REQUEST, 'Only a draft can be deleted');
  const issued = await ProductionOrderLog.findOne({ orderId: order.id, action: 'issued' });
  if (issued) throw new ApiError(httpStatus.BAD_REQUEST, 'Fabric has already been issued to this order');
  const completion = await FloorCompletion.findOne({ orderId: order.id });
  if (completion) throw new ApiError(httpStatus.BAD_REQUEST, 'Floor work has already started');
  await order.deleteOne();
  return { deleted: true };
};
