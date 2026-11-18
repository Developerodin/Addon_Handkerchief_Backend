import httpStatus from 'http-status';
import ApiError from '../../utils/ApiError.js';
import { CutPiece, ProductionOrder } from '../../models/production.model.js';
import Machine from '../../models/machine.model.js';
import { logPieces } from './pieceLog.js';
import { rackOfType } from './bundleFloor.js';
import { txnEntityUpdate } from './floorTxn.js';
import { completedPiecesFromLogs } from './floorCompleted.js';

const FROM_VERTICAL_CUT = [{ process: 'vertical-cut' }, { process: { $exists: false } }];

/**
 * Piece is still the vertical-cut piece, not a later process.
 * @param {{ process?: string }} piece
 */
const fromVerticalCut = (piece) => !piece.process || piece.process === 'vertical-cut';

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
 * @param {object[]} rows
 * @param {Map<string, string>} orderNumbers
 */
const shapePiece = (row, orderNumbers) => ({
  barcode: row.barcode,
  orderId: String(row.orderId),
  orderNumber: orderNumbers.get(String(row.orderId)) || '',
  rollBarcode: row.rollBarcode || '',
  rackCode: row.rackCode || '',
  machineBarcode: row.machineBarcode || '',
  status: row.status,
});

/**
 * Pieces on a rack after vertical cutting, plus pieces already on a selvage table.
 */
export const upcomingSelvage = async () => {
  const [waiting, active] = await Promise.all([
    CutPiece.find({ status: 'on-rack', $or: FROM_VERTICAL_CUT }).sort({ updatedAt: -1 }).limit(200).lean(),
    CutPiece.find({ status: 'in-work', $or: FROM_VERTICAL_CUT }).sort({ updatedAt: -1 }).limit(200).lean(),
  ]);
  const orderIds = [...new Set([...waiting, ...active].map((row) => String(row.orderId)))];
  const orders = await ProductionOrder.find({ _id: { $in: orderIds } }).select('orderNumber');
  const orderNumbers = new Map(orders.map((order) => [String(order.id), order.orderNumber || '']));
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const [doneToday, onRack] = await Promise.all([
    CutPiece.countDocuments({ process: 'selvage', updatedAt: { $gte: start } }),
    CutPiece.countDocuments({ process: 'selvage', status: 'on-rack' }),
  ]);
  const completed = await completedPiecesFromLogs(['selvage-done']);
  return {
    results: waiting.map((row) => shapePiece(row, orderNumbers)),
    active: active.map((row) => shapePiece(row, orderNumbers)),
    completed,
    counts: { waiting: waiting.length, onTable: active.length, doneToday, onRack, completed: completed.length },
  };
};

/**
 * One order log when every piece belongs to that order.
 * @param {object[]} pieces
 * @param {object} entry
 * @param {object | null} user
 */
/**
 * Picks racked vertical-cut pieces onto a table.
 * @param {{ pieceBarcodes?: string[], rackCode?: string, machineBarcode?: string }} body
 * @param {object} [_params]
 * @param {object | null} [user]
 */
export const startSelvage = async (body, _params, user) => {
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
    if (piece.status !== 'on-rack') throw new ApiError(httpStatus.BAD_REQUEST, 'This piece is already on the table');
    if (!fromVerticalCut(piece)) throw new ApiError(httpStatus.BAD_REQUEST, 'This piece is already selvaged');
    if (piece.rackCode !== rack.code) throw new ApiError(httpStatus.BAD_REQUEST, 'This piece is not on that rack');
  }
  return txnEntityUpdate({
    Model: CutPiece,
    filter: { barcode: { $in: codes } },
    update: { status: 'in-work', machineBarcode: machine.barcode },
    afterUpdate: (session) =>
      logPieces(pieces, { action: 'selvage-start', fromLocation: rack.code, toLocation: machine.barcode, remarks: '' }, user, session),
    load: (session) => CutPiece.find({ barcode: { $in: codes } }).session(session || undefined),
  });
};

/**
 * Puts selvage-finished pieces back on a pieces rack for half moon.
 * @param {{ pieceBarcodes?: string[], rackCode?: string }} body
 * @param {object} [_params]
 * @param {object | null} [user]
 */
export const placeSelvage = async (body, _params, user) => {
  const codes = pieceCodes(body.pieceBarcodes);
  const rackCode = String(body.rackCode || '').trim();
  if (!codes.length) throw new ApiError(httpStatus.BAD_REQUEST, 'Piece barcodes are required');
  if (!rackCode) throw new ApiError(httpStatus.BAD_REQUEST, 'Rack is required');
  const rack = await piecesRack(rackCode);
  const pieces = await CutPiece.find({ barcode: { $in: codes } });
  if (pieces.length !== codes.length) throw new ApiError(httpStatus.BAD_REQUEST, 'Piece not found');
  for (const piece of pieces) {
    if (piece.process === 'selvage') throw new ApiError(httpStatus.BAD_REQUEST, 'This piece is already selvaged');
    if (piece.status === 'cut' || !piece.rackCode) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'This piece is not on a rack');
    }
    if (piece.status !== 'in-work') throw new ApiError(httpStatus.BAD_REQUEST, 'This piece is not on the table');
    if (!fromVerticalCut(piece)) throw new ApiError(httpStatus.BAD_REQUEST, 'This piece is already selvaged');
  }
  return txnEntityUpdate({
    Model: CutPiece,
    filter: { barcode: { $in: codes } },
    update: { process: 'selvage', status: 'on-rack', rackCode: rack.code },
    afterUpdate: (session) =>
      logPieces(pieces, { action: 'selvage-done', fromLocation: '', toLocation: rack.code, remarks: '' }, user, session),
    load: (session) => CutPiece.find({ barcode: { $in: codes } }).session(session || undefined),
  });
};
