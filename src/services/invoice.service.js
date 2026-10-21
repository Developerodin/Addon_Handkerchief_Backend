import httpStatus from 'http-status';
import ApiError from '../utils/ApiError.js';
import { CreditNote, SalesInvoice, SupplierBill } from '../models/invoice.model.js';
import { DispatchBox } from '../models/warehouse.model.js';
import { GoodsReceipt, PurchaseOrder, VendorReturn } from '../models/store.model.js';
import { PackingBundle } from '../models/warehouse.model.js';
import { nextCode } from './factory/ids.js';

/**
 * One box opens one invoice. A second open returns the same number.
 * @param {{ boxId: string, hsn?: string, gst?: string, eventId?: string }} body
 */
export const openInvoice = async (body) => {
  const existing = await SalesInvoice.findOne({ boxId: body.boxId });
  if (existing) return existing;
  const box = await DispatchBox.findById(body.boxId);
  if (!box || box.status !== 'dispatched') {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Invoice waits for a dispatched box');
  }
  const bundles = await PackingBundle.find({ barcode: { $in: box.packingBundleIds } });
  const pieceCount = bundles.reduce((sum, row) => sum + row.qty, 0);
  return SalesInvoice.create({
    number: nextCode('INV'),
    eventId: body.eventId,
    boxId: box.id,
    clientAddress: box.clientAddress,
    lines: [{ hsn: body.hsn || '', gst: body.gst || '', pieceCount }],
  });
};

/**
 * A credit note is a new document. Invoice lines stay as posted.
 * @param {{ invoiceId: string, pieceCount: number, reason?: string }} body
 */
export const createCreditNote = async (body) => {
  const invoice = await SalesInvoice.findById(body.invoiceId);
  if (!invoice) throw new ApiError(httpStatus.NOT_FOUND, 'Invoice not found');
  const before = invoice.lines.map((line) => line.pieceCount);
  const note = await CreditNote.create(body);
  const after = await SalesInvoice.findById(invoice.id);
  if (after.lines.map((line) => line.pieceCount).join() !== before.join()) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Credit note must not change invoice lines');
  }
  return note;
};

/**
 * Bill shows GRN quantity, PO rate, and vendor-return quantity. It does not move stock.
 * @param {{ poId: string, grnId: string, returnId?: string }} body
 */
export const createSupplierBill = async (body) => {
  const po = await PurchaseOrder.findById(body.poId);
  const grn = await GoodsReceipt.findById(body.grnId);
  if (!po || !grn) throw new ApiError(httpStatus.NOT_FOUND, 'PO or GRN not found');
  const rolls = await (await import('../models/store.model.js')).FabricRoll.countDocuments({ grnId: grn.id });
  let returnQuantity = 0;
  if (body.returnId) {
    const row = await VendorReturn.findById(body.returnId);
    returnQuantity = row?.quantity || row?.rollBarcodes?.length || 0;
  }
  return SupplierBill.create({
    poId: po.id,
    grnId: grn.id,
    returnId: body.returnId || null,
    grnQuantity: rolls,
    poRate: po.lines[0]?.rate || 0,
    returnQuantity,
  });
};
