import httpStatus from 'http-status';
import ApiError from '../utils/ApiError.js';
import { CutPiece, FloorCompletion, PieceBundle, ProductionOrder, ThreadUse } from '../models/production.model.js';
import { FabricRoll } from '../models/store.model.js';
import Product from '../models/product.model.js';
import { nextCode } from './factory/ids.js';
import { writeOrderLog } from './orderLog.service.js';

const BUNDLE_SIZE = 60;

const NORMAL_FLOORS = [
  ['Cut', 'vertical-cut'],
  ['Selvage', 'selvage'],
  ['Half moon', 'half-moon'],
  ['Vertical hem', 'vertical-hem'],
  ['Bundle', 'single-piece-cutting'],
  ['Horizontal hem', 'horizontal-hem'],
  ['Thread cut', 'thread-cutting'],
  ['Iron', 'iron'],
];

/**
 * Fixed route used when the item has no processes. Normal stops after iron.
 * @param {string} productionType
 */
const defaultFloors = (productionType) => {
  const rows = NORMAL_FLOORS.map(([name, floor], index) => ({
    name,
    floor,
    sortOrder: index + 1,
    receivedQty: 0,
    completedQty: 0,
    transferredQty: 0,
  }));
  if (productionType === 'embroidery') {
    rows.push({ name: 'Embroidery', floor: 'embroidery', sortOrder: rows.length + 1, receivedQty: 0, completedQty: 0, transferredQty: 0 });
  }
  if (productionType === 'sticker') {
    rows.push({ name: 'Sticker', floor: 'sticker', sortOrder: rows.length + 1, receivedQty: 0, completedQty: 0, transferredQty: 0 });
  }
  return rows;
};

/**
 * Copies the item process list, in sort order, onto the order.
 * @param {object} body
 */
const snapshotFloors = async (body) => {
  if (!body.itemId) return defaultFloors(body.productionType);
  const product = await Product.findById(body.itemId).populate('processes.processId');
  const processes = (product?.processes || [])
    .map((row) => row.processId)
    .filter((process) => process && process.status !== 'inactive')
    .sort((left, right) => (left.sortOrder || 0) - (right.sortOrder || 0));
  if (!processes.length) return defaultFloors(body.productionType);
  return processes.map((process) => ({
    processId: String(process.id || process._id),
    name: process.name,
    floor: process.floor || process.name,
    sortOrder: process.sortOrder || 0,
    receivedQty: 0,
    completedQty: 0,
    transferredQty: 0,
  }));
};

/**
 * Releases an order on the revision it is given. Later publishes do not move it.
 * @param {object} body
 */
export const releaseOrder = async (body) => {
  const floors = await snapshotFloors(body);
  if (floors[0]) floors[0].receivedQty = body.targetQty;
  return ProductionOrder.create({
    itemId: body.itemId,
    productionType: body.productionType,
    revisionId: body.revisionId,
    targetQty: body.targetQty,
    priority: body.priority || 'Medium',
    orderNote: body.orderNote || '',
    currentFloor: floors[0]?.floor || '',
    floors,
    segments: [{ revisionId: body.revisionId, qty: body.targetQty, completedQty: 0 }],
  });
};

/**
 * Moves only the unfinished quantity onto a new revision.
 * @param {string} orderId
 * @param {{ revisionId: string, remainingQty: number }} body
 */
export const amendOrder = async (orderId, body) => {
  const order = await ProductionOrder.findById(orderId);
  if (!order) throw new ApiError(httpStatus.NOT_FOUND, 'Production order not found');
  const current = order.segments[order.segments.length - 1];
  const finished = current.completedQty;
  const remaining = body.remainingQty;
  if (finished + remaining !== current.qty && finished + remaining !== order.targetQty) {
    current.qty = finished;
  } else {
    current.qty = finished;
  }
  order.segments.push({ revisionId: body.revisionId, qty: remaining, completedQty: 0 });
  order.revisionId = body.revisionId;
  order.status = 'amended';
  await order.save();
  return order;
};

/**
 * Factory append. The cloud cannot post a completion. The same eventId is one row.
 * @param {object} body
 * @param {object} [_params]
 * @param {object | null} [user]
 */
export const completeStage = async (body, _params, user) => {
  if (body.site === 'cloud') {
    throw new ApiError(httpStatus.FORBIDDEN, 'Cloud cannot post a floor completion');
  }
  const existing = await FloorCompletion.findOne({ eventId: body.eventId });
  if (existing) return existing;
  const order = await ProductionOrder.findById(body.orderId);
  if (!order) throw new ApiError(httpStatus.NOT_FOUND, 'Production order not found');
  const floors = order.floors || [];
  if (floors.length && body.stage !== order.currentFloor) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'This order is not on that floor');
  }
  const operatorId = body.operatorId || (user ? String(user.id || user._id || '') : '');
  const completion = await FloorCompletion.create({ ...body, operatorId });
  const step = floors.find((row) => row.floor === body.stage);
  if (step) step.completedQty += body.qty;
  const segment = order.segments[order.segments.length - 1];
  segment.completedQty += body.qty;
  let toFloor = order.currentFloor || body.stage;
  if (step && step.completedQty >= order.targetQty) {
    const index = floors.findIndex((row) => row.floor === body.stage);
    if (!floors[index + 1]) {
      order.status = 'closed';
      toFloor = '';
    }
  }
  await order.save();
  await writeOrderLog(
    {
      action: 'floor-complete',
      orderId: order.id,
      entityType: 'order',
      entityCode: body.stage,
      quantity: body.qty,
      fromLocation: body.stage,
      toLocation: toFloor,
      remarks: body.remarks || body.machineBarcode || '',
    },
    user
  );
  return completion;
};

/**
 * Sends finished quantity to the next floor as a bundle barcode. The next floor does not receive it yet.
 * @param {string} orderId
 * @param {{ qty: number, remarks?: string }} body
 * @param {object | null} [user]
 */
export const transferBundle = async (orderId, body, user) => {
  const order = await ProductionOrder.findById(orderId);
  if (!order) throw new ApiError(httpStatus.NOT_FOUND, 'Production order not found');
  const floors = order.floors || [];
  const index = floors.findIndex((row) => row.floor === order.currentFloor);
  const step = floors[index];
  const next = floors[index + 1];
  if (!step || !next) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'This floor has no next process');
  }
  const qty = Number(body.qty);
  const available = (step.completedQty || 0) - (step.transferredQty || 0);
  if (!qty || qty < 1 || qty > available) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Transfer quantity is above the finished quantity still on this floor');
  }
  const last = await PieceBundle.findOne({ orderId: order.id }).sort({ number: -1 });
  const bundle = await PieceBundle.create({
    orderId: order.id,
    number: (last?.number || 0) + 1,
    qty,
    closed: true,
    barcode: nextCode('BD'),
    fromFloor: step.floor,
    toFloor: next.floor,
    status: 'in-transit',
  });
  step.transferredQty += qty;
  await order.save();
  await writeOrderLog(
    {
      action: 'bundle-transfer',
      orderId: order.id,
      entityType: 'bundle',
      entityCode: bundle.barcode,
      quantity: qty,
      fromLocation: step.floor,
      toLocation: next.floor,
      remarks: body.remarks || '',
    },
    user
  );
  return bundle;
};

/**
 * The next floor scans the bundle barcode. That is when the order moves.
 * @param {{ barcode: string, stage: string }} body
 * @param {object} [_params]
 * @param {object | null} [user]
 */
export const receiveBundle = async (body, _params, user) => {
  const bundle = await PieceBundle.findOne({ barcode: body.barcode });
  if (!bundle || bundle.status !== 'in-transit') {
    throw new ApiError(httpStatus.BAD_REQUEST, 'This barcode is not a bundle in transit');
  }
  if (bundle.toFloor !== body.stage) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'This bundle is not for that floor');
  }
  const order = await ProductionOrder.findById(bundle.orderId);
  if (!order) throw new ApiError(httpStatus.NOT_FOUND, 'Production order not found');
  const step = (order.floors || []).find((row) => row.floor === body.stage);
  if (!step) throw new ApiError(httpStatus.BAD_REQUEST, 'This bundle is not for that floor');
  step.receivedQty += bundle.qty;
  bundle.status = 'received';
  await bundle.save();
  order.currentFloor = body.stage;
  if (order.status === 'released') order.status = 'in-progress';
  await order.save();
  await writeOrderLog(
    {
      action: 'bundle-receive',
      orderId: order.id,
      entityType: 'bundle',
      entityCode: bundle.barcode,
      quantity: bundle.qty,
      fromLocation: bundle.fromFloor,
      toLocation: body.stage,
      remarks: '',
    },
    user
  );
  return bundle;
};

/**
 * Prints one barcode per piece and closes the roll.
 * @param {{ orderId: string, rollBarcode: string, pieceCount: number }} body
 */
export const cutRoll = async (body) => {
  const pieces = [];
  for (let index = 0; index < body.pieceCount; index += 1) {
    const piece = await recordPiece({ orderId: body.orderId, rollBarcode: body.rollBarcode });
    pieces.push(piece);
  }
  await FabricRoll.updateOne({ barcode: body.rollBarcode }, { status: 'on-floor' });
  return pieces;
};

/**
 * The 61st piece opens the next bundle. A bundle closes at 60.
 * @param {{ orderId: string, rollBarcode?: string, barcode?: string }} body
 */
export const recordPiece = async (body) => {
  let bundle = await PieceBundle.findOne({ orderId: body.orderId, closed: false }).sort({ number: -1 });
  if (!bundle || bundle.qty >= BUNDLE_SIZE) {
    const last = await PieceBundle.findOne({ orderId: body.orderId }).sort({ number: -1 });
    bundle = await PieceBundle.create({
      orderId: body.orderId,
      number: (last?.number || 0) + 1,
      qty: 0,
      closed: false,
    });
  }
  const piece = await CutPiece.create({
    barcode: body.barcode || nextCode('PC'),
    orderId: body.orderId,
    rollBarcode: body.rollBarcode || '',
    bundleId: bundle.id,
  });
  bundle.qty += 1;
  if (bundle.qty >= BUNDLE_SIZE) bundle.closed = true;
  await bundle.save();
  return piece;
};

/**
 * Stores a short last bundle at the counted quantity.
 * @param {{ orderId: string, qty: number }} body
 */
export const closePartialBundle = async (body) => {
  if (body.qty < 1 || body.qty > BUNDLE_SIZE) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Partial bundle qty must be 1 to 60');
  }
  const last = await PieceBundle.findOne({ orderId: body.orderId }).sort({ number: -1 });
  return PieceBundle.create({
    orderId: body.orderId,
    number: (last?.number || 0) + 1,
    qty: body.qty,
    closed: true,
  });
};

/**
 * Horizontal hemming refuses a bundle that checking did not mark good.
 * @param {string} bundleId
 */
export const hemBundle = async (bundleId) => {
  const bundle = await PieceBundle.findById(bundleId);
  if (!bundle) throw new ApiError(httpStatus.NOT_FOUND, 'Bundle not found');
  if (!bundle.checkedGood) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Bundle checking has not marked this bundle good');
  }
  return bundle;
};

/**
 * Sends route quantities to separate upcoming lists.
 * @param {string} bundleId
 * @param {{ normal: number, embroidery: number, sticker: number }} split
 */
export const breakBundle = async (bundleId, split) => {
  const bundle = await PieceBundle.findById(bundleId);
  if (!bundle) throw new ApiError(httpStatus.NOT_FOUND, 'Bundle not found');
  const total = (split.normal || 0) + (split.embroidery || 0) + (split.sticker || 0);
  if (total !== bundle.qty) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Route split must equal the bundle quantity');
  }
  bundle.routeSplit = split;
  await bundle.save();
  return bundle;
};

/**
 * Records thread use without editing the pinned BOM.
 * @param {object} body
 */
export const recordThreadUse = async (body) => ThreadUse.create(body);

/**
 * @param {string} bundleId
 * @param {boolean} good
 */
export const markBundleChecked = async (bundleId, good) => {
  const bundle = await PieceBundle.findById(bundleId);
  if (!bundle) throw new ApiError(httpStatus.NOT_FOUND, 'Bundle not found');
  bundle.checkedGood = good;
  await bundle.save();
  return bundle;
};
