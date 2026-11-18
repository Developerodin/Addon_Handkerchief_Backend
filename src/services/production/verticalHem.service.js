import httpStatus from 'http-status';
import ApiError from '../../utils/ApiError.js';
import { CutPiece, ProductionOrder, ThreadUse } from '../../models/production.model.js';
import Machine from '../../models/machine.model.js';
import RawMaterial from '../../models/rawMaterial.model.js';
import { rackOfType } from './bundleFloor.js';
import { runTransaction, sessionOptions } from '../../utils/mongoTransaction.js';
import { logPieces } from './pieceLog.js';
import { txnEntityUpdate } from './floorTxn.js';
import { completedPiecesFromLogs } from './floorCompleted.js';

/**
 * Piece is still the half-moon piece, not a later process.
 * @param {{ process?: string }} piece
 */
const fromHalfMoon = (piece) => piece.process === 'half-moon';

/**
 * Active pieces rack, matched by code or barcode.
 * @param {string} scanned
 */
const piecesRack = (scanned) => rackOfType(scanned, 'pieces', 'This rack is not for pieces');

/**
 * Unique scanned piece barcodes.
 * @param {string[] | undefined} barcodes
 */
const pieceCodes = (barcodes) => [...new Set((barcodes || []).map((code) => String(code || '').trim()).filter(Boolean))];

/**
 * Sewing-thread lines on the order line that owns this piece.
 * @param {object | undefined} order
 * @param {string} lineId
 * @param {Map<string, string>} names
 */
const sewingThread = (order, lineId, names) => {
  const matched = (order?.lines || []).find((line) => lineId && String(line.id) === lineId);
  const line = matched || order?.lines?.[0];
  const rows = (line?.snapshot?.threadLines || []).filter((row) => row.materialRole === 'sewing-thread');
  const lines = rows.map((row) => ({
    name: names.get(String(row.rawMaterialId || '')) || 'Sewing thread',
    perPiece: Number(row.quantity) || 0,
  }));
  return {
    lines,
    perPiece: lines.reduce((sum, row) => sum + row.perPiece, 0),
  };
};

/**
 * @param {object} row
 * @param {Map<string, object>} orders
 * @param {Map<string, string>} names
 */
const shapePiece = (row, orders, names) => {
  const order = orders.get(String(row.orderId));
  return {
    barcode: row.barcode,
    orderId: String(row.orderId),
    orderNumber: order?.orderNumber || '',
    rollBarcode: row.rollBarcode || '',
    rackCode: row.rackCode || '',
    machineBarcode: row.machineBarcode || '',
    status: row.status,
    sewingThread: sewingThread(order, row.lineId ? String(row.lineId) : '', names),
  };
};

/**
 * Order documents and raw-material names for the pieces on screen.
 * @param {object[]} rows
 */
const orderContext = async (rows) => {
  const orderIds = [...new Set(rows.map((row) => String(row.orderId)))];
  const orders = await ProductionOrder.find({ _id: { $in: orderIds } }).select('orderNumber lines');
  const materialIds = [
    ...new Set(
      orders.flatMap((order) =>
        (order.lines || []).flatMap((line) =>
          (line.snapshot?.threadLines || [])
            .filter((thread) => thread.materialRole === 'sewing-thread' && thread.rawMaterialId)
            .map((thread) => String(thread.rawMaterialId))
        )
      )
    ),
  ];
  const materials = materialIds.length ? await RawMaterial.find({ _id: { $in: materialIds } }).select('name') : [];
  return {
    orders: new Map(orders.map((order) => [String(order.id), order])),
    names: new Map(materials.map((material) => [String(material.id), material.name || 'Sewing thread'])),
  };
};

/**
 * Pieces on a rack after half moon, plus pieces already on a hemming machine.
 */
export const upcomingVerticalHem = async () => {
  const waitingQuery = { status: 'on-rack', process: 'half-moon' };
  const activeQuery = { status: 'in-work', process: 'half-moon' };
  const [waiting, active] = await Promise.all([
    CutPiece.find(waitingQuery).sort({ updatedAt: -1 }).limit(200).lean(),
    CutPiece.find(activeQuery).sort({ updatedAt: -1 }).limit(200).lean(),
  ]);
  const { orders, names } = await orderContext([...waiting, ...active]);
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const [doneToday, onRack] = await Promise.all([
    CutPiece.countDocuments({ process: 'vertical-hem', updatedAt: { $gte: start } }),
    CutPiece.countDocuments({ process: 'vertical-hem', status: 'on-rack' }),
  ]);
  const completed = await completedPiecesFromLogs(['vertical-hem-done']);
  return {
    results: waiting.map((row) => shapePiece(row, orders, names)),
    active: active.map((row) => shapePiece(row, orders, names)),
    completed,
    counts: { waiting: waiting.length, onTable: active.length, doneToday, onRack, completed: completed.length },
  };
};

/**
 * Picks racked half-moon pieces onto a hemming machine.
 * @param {{ pieceBarcodes?: string[], rackCode?: string, machineBarcode?: string }} body
 * @param {object} [_params]
 * @param {object | null} [user]
 */
export const startVerticalHem = async (body, _params, user) => {
  const codes = pieceCodes(body.pieceBarcodes);
  const rackCode = String(body.rackCode || '').trim();
  const machineBarcode = String(body.machineBarcode || '').trim();
  if (!codes.length) throw new ApiError(httpStatus.BAD_REQUEST, 'Piece barcodes are required');
  if (!rackCode) throw new ApiError(httpStatus.BAD_REQUEST, 'Rack is required');
  if (!machineBarcode) throw new ApiError(httpStatus.BAD_REQUEST, 'Machine barcode is required');
  const machine = await Machine.findOne({ barcode: machineBarcode, status: 'active' });
  if (!machine) throw new ApiError(httpStatus.BAD_REQUEST, 'Machine not found');
  const rack = await piecesRack(rackCode);
  const pieces = await CutPiece.find({ barcode: { $in: codes } });
  if (pieces.length !== codes.length) throw new ApiError(httpStatus.BAD_REQUEST, 'Piece not found');
  for (const piece of pieces) {
    if (piece.status === 'cut' || !piece.rackCode) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'This piece is not on a rack');
    }
    if (piece.status !== 'on-rack') throw new ApiError(httpStatus.BAD_REQUEST, 'This piece is already on the machine');
    if (piece.process === 'vertical-hem') throw new ApiError(httpStatus.BAD_REQUEST, 'This piece is already hemmed');
    if (!fromHalfMoon(piece)) throw new ApiError(httpStatus.BAD_REQUEST, 'This piece is not half mooned');
    if (piece.rackCode !== rack.code) throw new ApiError(httpStatus.BAD_REQUEST, 'This piece is not on that rack');
  }
  return txnEntityUpdate({
    Model: CutPiece,
    filter: { barcode: { $in: codes } },
    update: { status: 'in-work', machineBarcode: machine.barcode },
    afterUpdate: (session) =>
      logPieces(pieces, { action: 'vertical-hem-start', fromLocation: rack.code, toLocation: machine.barcode, remarks: '' }, user, session),
    load: (session) => CutPiece.find({ barcode: { $in: codes } }).session(session || undefined),
  });
};

/**
 * Thread quantity for the pieces on the machine. Zero is allowed.
 * @param {unknown} value
 */
const threadQuantity = (value) => {
  if (value == null || value === '') throw new ApiError(httpStatus.BAD_REQUEST, 'Thread quantity is required');
  const quantity = Number(value);
  if (Number.isNaN(quantity) || quantity < 0) throw new ApiError(httpStatus.BAD_REQUEST, 'Thread quantity is required');
  return quantity;
};

/**
 * Puts hemmed pieces back on a pieces rack and stores the sewing thread used.
 * @param {{ pieceBarcodes?: string[], rackCode?: string, threadQuantity?: number }} body
 * @param {object} [_params]
 * @param {object | null} [user]
 */
export const placeVerticalHem = async (body, _params, user) => {
  const codes = pieceCodes(body.pieceBarcodes);
  const rackCode = String(body.rackCode || '').trim();
  const used = threadQuantity(body.threadQuantity);
  if (!codes.length) throw new ApiError(httpStatus.BAD_REQUEST, 'Piece barcodes are required');
  if (!rackCode) throw new ApiError(httpStatus.BAD_REQUEST, 'Rack is required');
  const rack = await piecesRack(rackCode);
  const pieces = await CutPiece.find({ barcode: { $in: codes } });
  if (pieces.length !== codes.length) throw new ApiError(httpStatus.BAD_REQUEST, 'Piece not found');
  for (const piece of pieces) {
    if (piece.process === 'vertical-hem') throw new ApiError(httpStatus.BAD_REQUEST, 'This piece is already hemmed');
    if (!fromHalfMoon(piece)) throw new ApiError(httpStatus.BAD_REQUEST, 'This piece is not half mooned');
    if (piece.status === 'cut' || !piece.rackCode) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'This piece is not on a rack');
    }
    if (piece.status !== 'in-work') throw new ApiError(httpStatus.BAD_REQUEST, 'This piece is not on the machine');
  }
  const orderIds = [...new Set(pieces.map((piece) => String(piece.orderId)))];
  return runTransaction(async (session) => {
    await ThreadUse.create(
      orderIds.map((orderId) => ({
        orderId,
        machineBarcode: pieces.find((piece) => String(piece.orderId) === orderId)?.machineBarcode || '',
        materialRole: 'sewing-thread',
        quantity: used,
      })),
      sessionOptions(session)
    );
    await CutPiece.updateMany(
      { barcode: { $in: codes } },
      { process: 'vertical-hem', status: 'on-rack', rackCode: rack.code },
      sessionOptions(session)
    );
    await logPieces(pieces, { action: 'vertical-hem-done', fromLocation: '', toLocation: rack.code, remarks: '' }, user, session);
    return CutPiece.find({ barcode: { $in: codes } }).session(session || undefined);
  });
};
