import httpStatus from 'http-status';
import ApiError from '../../utils/ApiError.js';
import { CutPiece, ProductionOrder } from '../../models/production.model.js';
import Machine from '../../models/machine.model.js';
import StorageRack from '../../models/storageRack.model.js';
import { writeOrderLog } from '../orderLog.service.js';

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
  return {
    results: waiting.map((row) => shapePiece(row, orderNumbers)),
    active: active.map((row) => shapePiece(row, orderNumbers)),
    counts: { waiting: waiting.length, onTable: active.length, doneToday, onRack },
  };
};

/**
 * One order log when every piece belongs to that order.
 * @param {object[]} pieces
 * @param {object} entry
 * @param {object | null} user
 */
const logPieces = (pieces, entry, user) => {
  const orderIds = new Set(pieces.map((piece) => String(piece.orderId)));
  return writeOrderLog(
    {
      ...entry,
      orderId: orderIds.size === 1 ? pieces[0].orderId : undefined,
      entityType: 'roll',
      entityCode: pieces[0].barcode,
      quantity: pieces.length,
    },
    user
  );
};

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
  await CutPiece.updateMany({ barcode: { $in: codes } }, { status: 'in-work', machineBarcode: machine.barcode });
  await logPieces(
    pieces,
    { action: 'selvage-start', fromLocation: rack.code, toLocation: machine.barcode, remarks: '' },
    user
  );
  return CutPiece.find({ barcode: { $in: codes } });
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
  await CutPiece.updateMany(
    { barcode: { $in: codes } },
    { process: 'selvage', status: 'on-rack', rackCode: rack.code }
  );
  await logPieces(pieces, { action: 'selvage-done', fromLocation: '', toLocation: rack.code, remarks: '' }, user);
  return CutPiece.find({ barcode: { $in: codes } });
};
