import mongoose from 'mongoose';
import { toJSON } from './plugins/index.js';

const invoiceLineSchema = mongoose.Schema(
  {
    description: { type: String, default: 'Handkerchiefs' },
    hsn: { type: String, default: '' },
    gst: { type: String, default: '' },
    pieceCount: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const salesInvoiceSchema = mongoose.Schema(
  {
    number: { type: String, required: true, unique: true },
    eventId: { type: String, unique: true, sparse: true },
    boxId: { type: mongoose.SchemaTypes.ObjectId, ref: 'DispatchBox', required: true, unique: true },
    clientAddress: { type: String, default: '' },
    lines: [invoiceLineSchema],
  },
  { timestamps: true }
);

const creditNoteSchema = mongoose.Schema(
  {
    invoiceId: { type: mongoose.SchemaTypes.ObjectId, ref: 'SalesInvoice', required: true },
    pieceCount: { type: Number, required: true, min: 0 },
    reason: { type: String, default: '' },
  },
  { timestamps: true }
);

const supplierBillSchema = mongoose.Schema(
  {
    poId: { type: mongoose.SchemaTypes.ObjectId, ref: 'PurchaseOrder', required: true },
    grnId: { type: mongoose.SchemaTypes.ObjectId, ref: 'GoodsReceipt', required: true },
    returnId: { type: mongoose.SchemaTypes.ObjectId, ref: 'VendorReturn', default: null },
    grnQuantity: { type: Number, default: 0 },
    poRate: { type: Number, default: 0 },
    returnQuantity: { type: Number, default: 0 },
  },
  { timestamps: true }
);

salesInvoiceSchema.plugin(toJSON);
creditNoteSchema.plugin(toJSON);
supplierBillSchema.plugin(toJSON);

export const SalesInvoice = mongoose.model('SalesInvoice', salesInvoiceSchema);
export const CreditNote = mongoose.model('CreditNote', creditNoteSchema);
export const SupplierBill = mongoose.model('SupplierBill', supplierBillSchema);
