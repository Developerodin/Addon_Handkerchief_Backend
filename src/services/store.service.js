import httpStatus from 'http-status';
import ApiError from '../utils/ApiError.js';
import {
  FabricLot,
  FabricRoll,
  GoodsReceipt,
  PackingList,
  PurchaseOrder,
  StockMovement,
  VendorReturn,
} from '../models/store.model.js';
import { nextCode } from './factory/ids.js';
import { nextPurchaseOrderNumber } from './factory/purchaseOrderNumber.js';
import { writeOrderLog } from './orderLog.service.js';
import { placeRoll } from './factory/rackSlots.service.js';
import { enqueueEvent } from './sync/sync.service.js';
import { assertReceiptCutoffs, cutoffKey } from './factory/cutoffGate.js';
import { issueFabricRoll } from './factory/fabricIssue.service.js';
import { issueWholeBalance } from './factory/rollBalance.js';
import { returnFabricRoll } from './factory/fabricReturn.service.js';

const OFF_RACK = new Set(['', 'floor', 'vendor', 'dispatched']);

/**
 * Latest scan that is still a basement rack code. Floor and vendor are not racks.
 * @param {string} barcode
 */
const rackLocation = async (barcode) => {
  const row = await StockMovement.findOne({ entityType: 'roll', entityId: barcode }).sort({ createdAt: -1 });
  const location = row?.toLocation || '';
  return OFF_RACK.has(location) ? '' : location;
};

/**
 * Appends a status row. The clock is audit data, not a sync winner.
 * @param {import('mongoose').Document} po
 * @param {string} status
 * @param {string} [remarks]
 * @param {object | null} [user]
 */
const pushStatus = (po, status, remarks = '', user = null) => {
  po.status = status;
  const row = { status, at: new Date(), remarks, userName: user?.name || user?.email || '' };
  const userId = user?.id || user?._id;
  if (userId) row.userId = userId;
  po.statusHistory.push(row);
};

/**
 * Saves the PO and writes the status onto the activity log.
 * @param {import('mongoose').Document} po
 * @param {string} status
 * @param {string} remarks
 * @param {object | null} [user]
 */
export const saveStatus = async (po, status, remarks, user) => {
  pushStatus(po, status, remarks, user);
  await po.save();
  await writeOrderLog(
    {
      action: 'po-status',
      entityType: 'po',
      entityCode: po.number,
      remarks: remarks ? `${status}: ${remarks}` : status,
    },
    user
  );
  return po;
};

/**
 * @param {object} body
 * @param {object} [_params]
 * @param {object | null} [user]
 */
export const createPurchaseOrder = async (body, _params, user) => {
  const po = await PurchaseOrder.create({
    number: body.number || (await nextPurchaseOrderNumber()),
    supplierName: body.supplierName,
    supplierAddress: body.supplierAddress || '',
    supplierTerms: body.supplierTerms || '',
    purchaseDate: body.purchaseDate || new Date(),
    creditDays: body.creditDays ?? 0,
    estimatedDelivery: body.estimatedDelivery || null,
    notes: body.notes || '',
    lines: body.lines,
    status: 'Draft',
    statusHistory: [
      {
        status: 'Draft',
        at: new Date(),
        remarks: 'Created',
        userName: user?.name || user?.email || '',
        ...(user?.id || user?._id ? { userId: user.id || user._id } : {}),
      },
    ],
  });
  await writeOrderLog(
    { action: 'po-status', entityType: 'po', entityCode: po.number, remarks: 'Draft: Created' },
    user
  );
  return po;
};

/**
 * Draft and submitted orders can still change supplier and line quantity.
 * @param {string} poId
 * @param {object} body
 */
export const updatePurchaseOrder = async (poId, body) => {
  const po = await PurchaseOrder.findById(poId);
  if (!po) throw new ApiError(httpStatus.NOT_FOUND, 'Purchase order not found');
  if (!['Draft', 'Submitted to Vendor'].includes(po.status)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'This purchase order can no longer be edited');
  }
  if (body.supplierName) po.supplierName = body.supplierName;
  if (body.supplierAddress != null) po.supplierAddress = body.supplierAddress;
  if (body.estimatedDelivery) po.estimatedDelivery = body.estimatedDelivery;
  if (body.supplierTerms != null) po.supplierTerms = body.supplierTerms;
  if (body.purchaseDate) po.purchaseDate = body.purchaseDate;
  if (body.creditDays != null) po.creditDays = body.creditDays;
  if (body.notes != null) po.notes = body.notes;
  if (body.replaceLines && Array.isArray(body.lines)) {
    po.lines = body.lines;
  }
  if (Array.isArray(body.lines) && !body.replaceLines) {
    body.lines.forEach((patch) => {
      const line = po.lines.find((row) => row.lineId === patch.lineId);
      if (line && patch.quantity != null) line.quantity = patch.quantity;
    });
  }
  await po.save();
  return po;
};

/**
 * Permanent delete only before any goods are received.
 * @param {string} poId
 */
export const deletePurchaseOrder = async (poId) => {
  const po = await PurchaseOrder.findById(poId);
  if (!po) throw new ApiError(httpStatus.NOT_FOUND, 'Purchase order not found');
  if (!['Submitted to Vendor', 'In Transit'].includes(po.status)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Only a submitted or in-transit order can be deleted');
  }
  const lots = await FabricLot.find({ poId: po.id });
  const lotIds = lots.map((lot) => lot.id);
  await PackingList.deleteMany({ lotId: { $in: lotIds } });
  await FabricLot.deleteMany({ poId: po.id });
  await po.deleteOne();
  return po;
};

export const submitPurchaseOrder = async (poId, user) => {
  const po = await PurchaseOrder.findById(poId);
  if (!po) throw new ApiError(httpStatus.NOT_FOUND, 'Purchase order not found');
  if (po.status !== 'Draft') throw new ApiError(httpStatus.BAD_REQUEST, 'Only a draft can be submitted');
  if (!po.supplierName) throw new ApiError(httpStatus.BAD_REQUEST, 'Supplier is required');
  if (!po.lines?.length) throw new ApiError(httpStatus.BAD_REQUEST, 'At least one fabric item is required');
  po.lines.forEach((line, index) => {
    const label = `Item ${index + 1}`;
    if (!line.fabricName) throw new ApiError(httpStatus.BAD_REQUEST, `${label} needs a fabric`);
    if (!(line.quantity > 0)) throw new ApiError(httpStatus.BAD_REQUEST, `${label} quantity must be greater than 0`);
    if (!(line.rate > 0)) throw new ApiError(httpStatus.BAD_REQUEST, `${label} rate must be greater than 0`);
    if (line.gstPercent < 0 || line.gstPercent > 100) {
      throw new ApiError(httpStatus.BAD_REQUEST, `${label} GST must be between 0 and 100`);
    }
  });
  return saveStatus(po, 'Submitted to Vendor', 'Submitted', user);
};

/**
 * Accounts may set rate and GST only while the PO is still a draft.
 * @param {string} poId
 * @param {{ lineId: string, rate?: number, gstPercent?: number }} patch
 */
export const setDraftCommercials = async (poId, patch) => {
  const po = await PurchaseOrder.findById(poId);
  if (!po) throw new ApiError(httpStatus.NOT_FOUND, 'Purchase order not found');
  if (po.status !== 'Draft') throw new ApiError(httpStatus.BAD_REQUEST, 'Submitted rate and GST are frozen');
  const line = po.lines.find((row) => row.lineId === patch.lineId);
  if (!line) throw new ApiError(httpStatus.NOT_FOUND, 'PO line not found');
  if (patch.rate != null) line.rate = patch.rate;
  if (patch.gstPercent != null) line.gstPercent = patch.gstPercent;
  await po.save();
  return po;
};

/**
 * @param {string} poId
 * @param {Array<{ fabricId: string }>} cutoffs
 */
export const createLot = async (poId, cutoffs) => {
  const po = await PurchaseOrder.findById(poId);
  if (!po) throw new ApiError(httpStatus.NOT_FOUND, 'Purchase order not found');
  return FabricLot.create({
    poId,
    cutoffs: cutoffs.map((row) => ({ fabricId: String(row.fabricId), approved: false })),
  });
};

/**
 * Records each fabric decision. The lot is approved only when every cutoff is approved.
 * A decision for a fabric that is not on the lot yet is added, still only if the caller sent it.
 * @param {string} lotId
 * @param {Array<{ fabricId: string, approved: boolean }>} decisions
 */
export const decideCutoffs = async (lotId, decisions) => {
  const lot = await FabricLot.findById(lotId);
  if (!lot) throw new ApiError(httpStatus.NOT_FOUND, 'Lot not found');
  decisions.forEach((row) => {
    const fabricId = String(row.fabricId);
    const cutoff = lot.cutoffs.find((item) => item.fabricId === fabricId);
    if (cutoff) cutoff.approved = Boolean(row.approved);
    else lot.cutoffs.push({ fabricId, approved: Boolean(row.approved) });
  });
  const allApproved = lot.cutoffs.length > 0 && lot.cutoffs.every((row) => row.approved);
  lot.status = allApproved ? 'approved' : 'pending-cutoff';
  await lot.save();
  return lot;
};

/**
 * Creates one GRN and one barcode per roll. Repeating eventId returns the same GRN.
 * @param {object} body
 * @param {object} [_params]
 * @param {object | null} [user]
 */
export const receiveLot = async (body, _params, user) => {
  if (body.eventId) {
    const existing = await GoodsReceipt.findOne({ eventId: body.eventId });
    if (existing) {
      const rolls = await FabricRoll.find({ grnId: existing.id || existing._id });
      return { grn: existing, rolls };
    }
  }
  const lot = await FabricLot.findById(body.lotId);
  if (!lot) throw new ApiError(httpStatus.NOT_FOUND, 'Lot not found');
  const po = await PurchaseOrder.findById(lot.poId);
  if (!po) throw new ApiError(httpStatus.NOT_FOUND, 'Purchase order not found');
  assertReceiptCutoffs(lot, body.rolls || []);
  const packing = await PackingList.findOne({ lotId: lot.id });
  if (!packing || !['In Transit', 'Partially Received'].includes(po.status)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'This lot is not in transit');
  }
  const grn = await GoodsReceipt.create({
    number: body.number || nextCode('GRN'),
    eventId: body.eventId,
    lotId: lot.id,
    poId: po.id,
    receivedDate: body.receivedDate || new Date(),
    netWeight: body.netWeight || 0,
    grossWeight: body.grossWeight || 0,
    condition: body.condition || '',
    receiver: body.receiver || user?.name || user?.email || '',
    supplierName: po.supplierName,
    supplierAddress: po.supplierAddress,
    supplierTerms: po.supplierTerms,
  });
  const rolls = [];
  for (const roll of body.rolls || []) {
    const line = po.lines.find((row) => cutoffKey(row) === String(roll.fabricId || '')) || po.lines[0];
    const created = await FabricRoll.create({
      barcode: roll.barcode || nextCode('ROLL'),
      lotId: lot.id,
      grnId: grn.id,
      poId: po.id,
      fabricId: roll.fabricId || line?.fabricId || '',
      scaleWeight: roll.scaleWeight,
      condition: roll.condition || 'good',
      rate: line?.rate || 0,
      gstPercent: line?.gstPercent || 0,
    });
    rolls.push(created);
  }
  if (rolls.length) {
    const ordered = po.lines.reduce((sum, line) => sum + (line.quantity || 0), 0);
    const receivedRolls = await FabricRoll.find({ poId: po.id });
    const receivedQty = receivedRolls.reduce((sum, roll) => sum + (roll.scaleWeight || 0), 0);
    const next = ordered > 0 && receivedQty >= ordered ? 'Received' : 'Partially Received';
    await saveStatus(po, next, grn.number, user);
  }
  await writeOrderLog(
    {
      action: 'grn',
      entityType: 'grn',
      entityCode: grn.number,
      quantity: rolls.length,
      remarks: String(lot.id),
    },
    user
  );
  if (body.eventId) {
    await enqueueEvent({
      eventId: body.eventId,
      entityType: 'grn',
      aggregateId: String(grn.id),
      operation: 'receive',
      payload: { grnId: String(grn.id), lotId: String(lot.id) },
      dependsOn: body.dependsOn || [],
    });
  }
  return { grn, rolls };
};

/**
 * Latest movement wins. Occupancy is that count, not a stored balance.
 * @param {string} rackCode
 */
export const rackOccupancy = async (rackCode) => {
  const rows = await StockMovement.find({ entityType: 'roll' }).sort({ createdAt: 1 });
  const latest = new Map();
  rows.forEach((row) => latest.set(row.entityId, row));
  let count = 0;
  latest.forEach((row) => {
    if (row.toLocation === rackCode) count += 1;
  });
  return count;
};

/**
 * @param {{ rollBarcode: string, rackCode: string, eventId?: string }} body
 * @param {object} [_params]
 * @param {object | null} [user]
 */
/**
 * Stores a QC-passed roll on a real rack. The rack is resolved from its code or barcode.
 */
export const rackRoll = (body, _params, user) => placeRoll(body, user);

/**
 * A held lot cannot be issued. A passed lot moves rolls to the floor.
 * @param {{ lotId: string, rollBarcodes: string[], orderId?: string, eventId?: string }} body
 * @param {object | null} [user]
 */
export const issueRolls = async (body, user) => {
  const lot = await FabricLot.findById(body.lotId);
  if (!lot) throw new ApiError(httpStatus.NOT_FOUND, 'Lot not found');
  if (lot.qcStatus !== 'passed') {
    throw new ApiError(httpStatus.BAD_REQUEST, 'A held or unchecked lot cannot be issued');
  }
  const movements = [];
  for (const barcode of body.rollBarcodes) {
    const eventId = body.eventId ? `${body.eventId}:${barcode}` : undefined;
    if (eventId) {
      const existing = await StockMovement.findOne({ eventId });
      if (existing) {
        movements.push(existing);
        continue;
      }
    }
    const roll = await FabricRoll.findOne({ barcode });
    if (!roll) throw new ApiError(httpStatus.NOT_FOUND, `Roll ${barcode} not found`);
    if (roll.qcStatus === 'rejected' || roll.qcStatus === 'held') {
      throw new ApiError(httpStatus.BAD_REQUEST, 'A rejected or held roll cannot be issued');
    }
    const fromLocation = await rackLocation(barcode);
    if (!fromLocation) throw new ApiError(httpStatus.BAD_REQUEST, 'Roll is not on a rack');
    const movement = await issueWholeBalance(roll, { eventId, fromLocation, toLocation: 'floor' }, user);
    await writeOrderLog(
      {
        action: 'issued',
        orderId: body.orderId,
        entityType: 'roll',
        entityCode: barcode,
        fromLocation,
        toLocation: 'floor',
      },
      user
    );
    movements.push(movement);
  }
  return movements;
};

/**
 * Issues one scanned roll onto a production order.
 * The issue screen also sends the article line and fabric line.
 * @param {object} body
 * @param {object | null} [user]
 */
export const issueByBarcode = (body, user) => issueFabricRoll(body, user);

/**
 * @param {object} body
 * @param {object} [_params]
 * @param {object | null} [user]
 */
export const vendorReturn = async (body, _params, user) => {
  const po = await PurchaseOrder.findById(body.poId);
  const grn = await GoodsReceipt.findById(body.grnId);
  if (!po || !grn) throw new ApiError(httpStatus.NOT_FOUND, 'PO or GRN not found');
  const row = await VendorReturn.create(body);
  for (const barcode of body.rollBarcodes || []) {
    const fromLocation = await rackLocation(barcode);
    await StockMovement.create({
      entityType: 'roll',
      entityId: barcode,
      kind: 'vendor-return',
      fromLocation,
      toLocation: 'vendor',
      quantity: 1,
    });
    await FabricRoll.updateOne({ barcode }, { status: 'returned-to-vendor' });
    await writeOrderLog(
      {
        action: 'vendor-return',
        entityType: 'roll',
        entityCode: barcode,
        fromLocation,
        toLocation: 'vendor',
        remarks: body.reason || '',
      },
      user
    );
  }
  await saveStatus(po, 'Return to Vendor', String(row.id), user);
  return row;
};

/**
 * Puts an issued roll back on a rack for one production article.
 * @param {object} body
 * @param {object} [_params]
 * @param {object | null} [user]
 */
export const receiveRollBack = (body, _params, user) => returnFabricRoll(body, user);
