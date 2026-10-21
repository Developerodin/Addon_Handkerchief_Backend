import httpStatus from 'http-status';
import ApiError from '../../utils/ApiError.js';
import { FabricLot, PurchaseOrder } from '../../models/store.model.js';
import { saveStatus } from '../store.service.js';

/**
 * Newest cutoff lot for this purchase order.
 * @param {string} poId
 */
async function latestCutoffs(poId) {
  const lot = await FabricLot.findOne({ poId }).sort({ createdAt: -1 });
  return lot?.cutoffs || [];
}

/**
 * Replaces received lots and moves the PO to Received or Partially Received.
 * A line can be received only after its cutoff is approved.
 * @param {string} poId
 * @param {{ lots?: object[] }} body
 * @param {object | null} [user]
 */
export async function saveReceivedLots(poId, body, user) {
  const po = await PurchaseOrder.findById(poId);
  if (!po) throw new ApiError(httpStatus.NOT_FOUND, 'Purchase order not found');
  if (!['In Transit', 'Partially Received', 'Received'].includes(po.status)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Goods can be received only after the order is in transit');
  }
  const cutoffs = await latestCutoffs(po.id);
  const approved = new Set(cutoffs.filter((row) => row.approved).map((row) => String(row.fabricId)));
  const previous = new Map((po.receivedLots || []).map((lot) => [lot.lotNumber, lot]));
  const lots = (body.lots || []).map((lot, index) => normalizeLot(po, lot, index, approved, previous));
  if (!lots.length) throw new ApiError(httpStatus.BAD_REQUEST, 'Add at least one received lot');
  po.receivedLots = lots;
  const receivedByLine = new Map();
  lots.forEach((lot) => {
    lot.lines.forEach((line) => {
      receivedByLine.set(line.lineId, (receivedByLine.get(line.lineId) || 0) + line.receivedQuantity);
    });
  });
  const any = [...receivedByLine.values()].some((qty) => qty > 0);
  const allFull = po.lines.length > 0 && po.lines.every((line) => (receivedByLine.get(line.lineId) || 0) >= (line.quantity || 0));
  const next = allFull ? 'Received' : any ? 'Partially Received' : po.status;
  if (next !== po.status) return saveStatus(po, next, lots.map((lot) => lot.lotNumber).join(', '), user);
  await po.save();
  return po;
}

/**
 * @param {import('mongoose').Document} po
 * @param {object} lot
 * @param {number} index
 * @param {Set<string>} approved
 * @param {Map<string, object>} previous
 */
function normalizeLot(po, lot, index, approved, previous) {
  const label = `Lot ${index + 1}`;
  const lotNumber = String(lot.lotNumber || '').trim();
  if (!lotNumber) throw new ApiError(httpStatus.BAD_REQUEST, `${label}: lot number is required`);
  if (!(Number(lot.rolls) > 0)) throw new ApiError(httpStatus.BAD_REQUEST, `${label}: rolls must be greater than 0`);
  if (!(Number(lot.grossWeight) > 0)) throw new ApiError(httpStatus.BAD_REQUEST, `${label}: gross weight must be greater than 0`);
  if (!(Number(lot.netWeight) > 0)) throw new ApiError(httpStatus.BAD_REQUEST, `${label}: net weight must be greater than 0`);
  const lines = (lot.lines || []).map((line) => {
    const poLine = po.lines.find((row) => row.lineId === line.lineId);
    if (!poLine) throw new ApiError(httpStatus.BAD_REQUEST, `${label}: select a PO line`);
    const key = String(poLine.fabricId || poLine.lineId);
    if (!approved.has(key)) throw new ApiError(httpStatus.BAD_REQUEST, `${label}: cutoff is not approved`);
    if (!(Number(line.receivedQuantity) > 0)) {
      throw new ApiError(httpStatus.BAD_REQUEST, `${label}: received quantity must be greater than 0`);
    }
    return { lineId: poLine.lineId, receivedQuantity: Number(line.receivedQuantity) };
  });
  if (!lines.length) throw new ApiError(httpStatus.BAD_REQUEST, `${label}: select at least one PO line`);
  const prior = previous.get(lotNumber);
  return {
    lotNumber,
    rolls: Number(lot.rolls),
    grossWeight: Number(lot.grossWeight),
    netWeight: Number(lot.netWeight),
    lines,
    qcStatus: prior?.qcStatus || 'pending',
    qcBy: prior?.qcBy || '',
    qcAt: prior?.qcAt || null,
    qcRemarks: prior?.qcRemarks || '',
  };
}
