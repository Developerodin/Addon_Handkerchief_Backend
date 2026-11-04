import httpStatus from 'http-status';
import mongoose from 'mongoose';
import ApiError from '../../utils/ApiError.js';
import { CutPiece, ProductionOrder } from '../../models/production.model.js';
import { FabricRoll, StockMovement } from '../../models/store.model.js';
import Machine from '../../models/machine.model.js';
import Container from '../../models/container.model.js';
import StorageRack from '../../models/storageRack.model.js';
import { nextCode } from '../factory/ids.js';
import { writeOrderLog } from '../orderLog.service.js';

const OPEN = new Set(['released', 'in-progress', 'amended']);
const ISSUED = new Set(['issued', 'on-floor']);

/**
 * Pieces per cut pinned on the article line. Missing pin stays at 3.
 * @param {object} order
 * @param {string} [lineId]
 * @returns {3 | 4}
 */
const piecesPerCutOf = (order, lineId) => {
  const line = lineId && order.lines?.id ? order.lines.id(lineId) : null;
  const picked = line || (order.lines?.length === 1 ? order.lines[0] : null);
  return Number(picked?.piecesPerCut || picked?.snapshot?.piecesPerCut) === 4 ? 4 : 3;
};

/**
 * Released, in-progress, or amended orders can be cut.
 * @param {string} orderId
 */
const loadOpenOrder = async (orderId) => {
  if (!orderId || !mongoose.Types.ObjectId.isValid(orderId)) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Production order not found');
  }
  const order = await ProductionOrder.findById(orderId);
  if (!order) throw new ApiError(httpStatus.NOT_FOUND, 'Production order not found');
  if (!OPEN.has(order.status)) throw new ApiError(httpStatus.BAD_REQUEST, 'This order is not open');
  return order;
};

/**
 * Latest issue of this roll to this order that has not been returned.
 * @param {string} barcode
 * @param {import('mongoose').Types.ObjectId | string} orderId
 */
const openIssue = async (barcode, orderId) => {
  const issue = await StockMovement.findOne({
    entityType: 'roll',
    entityId: barcode,
    kind: 'issue',
    orderId,
  }).sort({ createdAt: -1 });
  if (!issue) return null;
  const returned = await StockMovement.findOne({
    entityType: 'roll',
    entityId: barcode,
    kind: 'return-to-rack',
    createdAt: { $gt: issue.createdAt },
  });
  return returned ? null : issue;
};

/**
 * Tile counts for the vertical cutting board.
 */
const cutCounts = async () => {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const [cutToday, onRack, onMachine] = await Promise.all([
    CutPiece.countDocuments({ createdAt: { $gte: start } }),
    CutPiece.countDocuments({ status: 'on-rack' }),
    CutPiece.distinct('rollBarcode', { status: 'cut' }),
  ]);
  return { cutToday, onRack, onMachine: onMachine.filter(Boolean).length };
};

/**
 * Rolls already cut whose pieces are not all on a rack yet.
 */
const activeCuts = async () => {
  const open = await CutPiece.find({ status: 'cut' }).select('rollBarcode').lean();
  const rollBarcodes = [...new Set(open.map((row) => row.rollBarcode).filter(Boolean))];
  if (!rollBarcodes.length) return [];
  const pieces = await CutPiece.find({ rollBarcode: { $in: rollBarcodes } }).sort({ createdAt: 1 }).lean();
  const rolls = await FabricRoll.find({ barcode: { $in: rollBarcodes } }).lean();
  const rollByCode = new Map(rolls.map((row) => [row.barcode, row]));
  const orderIds = [...new Set(pieces.map((row) => String(row.orderId)))];
  const orders = await ProductionOrder.find({ _id: { $in: orderIds } });
  const orderById = new Map(orders.map((order) => [String(order.id), order]));
  const grouped = new Map();
  for (const piece of pieces) {
    const key = piece.rollBarcode;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(piece);
  }
  return [...grouped.entries()].map(([rollBarcode, rows]) => {
    const order = orderById.get(String(rows[0].orderId));
    const roll = rollByCode.get(rollBarcode);
    return {
      rollBarcode,
      orderId: String(rows[0].orderId),
      orderNumber: order?.orderNumber || '',
      fabricName: roll?.fabricName || '',
      qtyMeters: Number(roll?.qtyMeters) || 0,
      piecesPerCut: rows.length,
      machineBarcode: rows[0].machineBarcode || '',
      pieces: rows.map((row) => ({ barcode: row.barcode, status: row.status || 'cut' })),
    };
  });
};

/**
 * Issued rolls that have no cut pieces, for open orders.
 */
export const upcomingCuts = async () => {
  const issues = await StockMovement.find({ kind: 'issue', entityType: 'roll', orderId: { $ne: null } })
    .sort({ createdAt: -1 })
    .limit(500)
    .lean();
  const latest = new Map();
  for (const row of issues) {
    if (!latest.has(row.entityId)) latest.set(row.entityId, row);
  }
  const barcodes = [...latest.keys()];
  const [rolls, cutRolls, returns, orders, counts, active] = await Promise.all([
    FabricRoll.find({ barcode: { $in: barcodes }, status: { $in: [...ISSUED] } }).lean(),
    CutPiece.distinct('rollBarcode', { rollBarcode: { $in: barcodes } }),
    StockMovement.find({ entityType: 'roll', entityId: { $in: barcodes }, kind: 'return-to-rack' })
      .select('entityId createdAt')
      .lean(),
    ProductionOrder.find({ _id: { $in: [...new Set([...latest.values()].map((row) => String(row.orderId)))] } }),
    cutCounts(),
    activeCuts(),
  ]);
  const rollByCode = new Map(rolls.map((row) => [row.barcode, row]));
  const cutSet = new Set(cutRolls.filter(Boolean));
  const orderById = new Map(orders.map((order) => [String(order.id), order]));
  const results = [];
  for (const [barcode, issue] of latest) {
    const roll = rollByCode.get(barcode);
    const order = orderById.get(String(issue.orderId));
    if (!roll || !order || !OPEN.has(order.status) || cutSet.has(barcode)) continue;
    const sentBack = returns.some(
      (row) => row.entityId === barcode && new Date(row.createdAt).getTime() > new Date(issue.createdAt).getTime()
    );
    if (sentBack) continue;
    results.push({
      rollBarcode: barcode,
      rollCode: roll.rollCode || '',
      orderId: String(order.id),
      orderNumber: order.orderNumber || '',
      fabricName: issue.fabricName || roll.fabricName || '',
      qtyMeters: Number(issue.qtyMeters) || Number(roll.qtyMeters) || 0,
      piecesPerCut: piecesPerCutOf(order, issue.lineId),
      issuedAt: issue.createdAt,
      lineId: issue.lineId || '',
    });
    if (results.length >= 200) break;
  }
  return { results, active, counts: { ...counts, waiting: results.length } };
};

/**
 * Cuts an issued roll into the planned 3 or 4 pieces and closes the roll.
 * @param {{ orderId?: string, rollBarcode?: string, machineBarcode?: string }} body
 * @param {object} [_params]
 * @param {object | null} [user]
 */
export const cutRoll = async (body, _params, user) => {
  const order = await loadOpenOrder(body.orderId);
  const machineBarcode = String(body.machineBarcode || '').trim();
  if (!machineBarcode) throw new ApiError(httpStatus.BAD_REQUEST, 'Machine barcode is required');
  const machine = await Machine.findOne({ barcode: machineBarcode, status: 'active' });
  if (!machine) throw new ApiError(httpStatus.BAD_REQUEST, 'Machine not found');
  const scanned = String(body.rollBarcode || '').trim();
  if (!scanned) throw new ApiError(httpStatus.BAD_REQUEST, 'Roll barcode is required');
  const roll = await FabricRoll.findOne({ $or: [{ barcode: scanned }, { rollCode: scanned }] });
  if (!roll) throw new ApiError(httpStatus.NOT_FOUND, 'Roll not found');
  if (!ISSUED.has(roll.status)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'This roll is not issued to that order');
  }
  const issue = await openIssue(roll.barcode, order.id);
  if (!issue) throw new ApiError(httpStatus.BAD_REQUEST, 'This roll is not issued to that order');
  const already = await CutPiece.countDocuments({ rollBarcode: roll.barcode });
  if (already) throw new ApiError(httpStatus.BAD_REQUEST, 'This roll is already cut');

  const count = piecesPerCutOf(order, issue.lineId);
  const lineId = issue.lineId && mongoose.Types.ObjectId.isValid(issue.lineId) ? issue.lineId : null;
  const pieces = await CutPiece.insertMany(
    Array.from({ length: count }, () => ({
      barcode: nextCode('PC'),
      orderId: order.id,
      lineId,
      rollBarcode: roll.barcode,
      machineBarcode: machine.barcode,
      status: 'cut',
      process: 'vertical-cut',
    }))
  );
  roll.status = 'cut';
  await roll.save();
  await writeOrderLog(
    {
      action: 'vertical-cut',
      orderId: order.id,
      entityType: 'roll',
      entityCode: roll.barcode,
      quantity: count,
      fromLocation: machine.barcode,
      toLocation: 'vertical-cut',
      remarks: '',
    },
    user
  );
  return pieces;
};

/**
 * Active pieces container, matched by barcode or code.
 * @param {string} scanned
 */
const piecesContainer = async (scanned) => {
  const container = await Container.findOne({
    status: 'active',
    $or: [{ barcode: scanned }, { code: scanned.toUpperCase() }],
  });
  if (!container) throw new ApiError(httpStatus.BAD_REQUEST, 'Container not found');
  if (container.type !== 'pieces') throw new ApiError(httpStatus.BAD_REQUEST, 'This container is not for pieces');
  return container;
};

/**
 * Active pieces rack, matched by code or barcode.
 * @param {string} scanned
 */
const piecesRack = async (scanned) => {
  const rack = await StorageRack.findOne({
    status: 'active',
    $or: [{ code: scanned.toUpperCase() }, { barcode: scanned }, { barcode: scanned.toUpperCase() }],
  });
  if (!rack) throw new ApiError(httpStatus.BAD_REQUEST, 'Rack not found');
  if (rack.stockType !== 'pieces') throw new ApiError(httpStatus.BAD_REQUEST, 'This rack is not for pieces');
  return rack;
};

/**
 * Puts cut pieces into a pieces container and onto a pieces rack.
 * @param {{ pieceBarcodes?: string[], containerBarcode?: string, rackCode?: string }} body
 * @param {object} [_params]
 * @param {object | null} [user]
 */
export const placePieces = async (body, _params, user) => {
  const codes = [...new Set((body.pieceBarcodes || []).map((code) => String(code || '').trim()).filter(Boolean))];
  if (!codes.length) throw new ApiError(httpStatus.BAD_REQUEST, 'Piece barcodes are required');
  const containerCode = String(body.containerBarcode || '').trim();
  const rackCode = String(body.rackCode || '').trim();
  if (!containerCode) throw new ApiError(httpStatus.BAD_REQUEST, 'Container barcode is required');
  if (!rackCode) throw new ApiError(httpStatus.BAD_REQUEST, 'Rack is required');
  const [container, rack] = await Promise.all([piecesContainer(containerCode), piecesRack(rackCode)]);
  const pieces = await CutPiece.find({ barcode: { $in: codes } });
  if (pieces.length !== codes.length) throw new ApiError(httpStatus.BAD_REQUEST, 'Piece not found');
  if (pieces.some((piece) => piece.status !== 'cut')) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'This piece is already on a rack');
  }
  const containerBarcode = container.barcode || container.code;
  await CutPiece.updateMany(
    { barcode: { $in: codes } },
    { status: 'on-rack', process: 'vertical-cut', containerBarcode, rackCode: rack.code }
  );
  const orderIds = new Set(pieces.map((piece) => String(piece.orderId)));
  await writeOrderLog(
    {
      action: 'piece-place',
      orderId: orderIds.size === 1 ? pieces[0].orderId : undefined,
      entityType: 'roll',
      entityCode: pieces[0].rollBarcode,
      quantity: pieces.length,
      fromLocation: containerBarcode,
      toLocation: rack.code,
      remarks: '',
    },
    user
  );
  return CutPiece.find({ barcode: { $in: codes } });
};
