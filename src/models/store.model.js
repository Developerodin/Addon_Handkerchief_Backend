import mongoose from 'mongoose';
import { toJSON } from './plugins/index.js';

const poLineSchema = mongoose.Schema(
  {
    lineId: { type: String, required: true },
    fabricId: { type: mongoose.SchemaTypes.ObjectId, ref: 'FabricCatalog' },
    fabricName: { type: String, default: '' },
    fabricTypeName: { type: String, default: '' },
    colourName: { type: String, default: '' },
    fabricSortNo: { type: String, default: '' },
    millOldFabricSortNo: { type: String, default: '' },
    millNewFabricSortNo: { type: String, default: '' },
    quantity: { type: Number, required: true, min: 0 },
    unitId: { type: mongoose.SchemaTypes.ObjectId, ref: 'FabricMeasurement' },
    unitName: { type: String, default: '' },
    priority: { type: Boolean, default: false },
    sentToSupplier: { type: Boolean, default: true },
    rate: { type: Number, default: 0 },
    gstPercent: { type: Number, default: 0 },
    estimatedDelivery: { type: Date, default: null },
  },
  { _id: false }
);

const purchaseOrderSchema = mongoose.Schema(
  {
    number: { type: String, required: true, unique: true },
    supplierName: { type: String, required: true },
    supplierAddress: { type: String, default: '' },
    supplierTerms: { type: String, default: '' },
    purchaseDate: { type: Date, default: Date.now },
    creditDays: { type: Number, default: 0, min: 0 },
    estimatedDelivery: { type: Date, default: null },
    notes: { type: String, default: '' },
    status: {
      type: String,
      enum: [
        'Draft',
        'Submitted to Vendor',
        'In Transit',
        'Received',
        'Partially Received',
        'Return to Vendor',
        'Completed',
        'Rejected',
      ],
      default: 'Draft',
    },
    lines: [poLineSchema],
    receivedLots: [
      {
        lotNumber: { type: String, required: true, trim: true },
        rolls: { type: Number, default: 0, min: 0 },
        grossWeight: { type: Number, default: 0, min: 0 },
        netWeight: { type: Number, default: 0, min: 0 },
        lines: [
          {
            lineId: { type: String, required: true },
            receivedQuantity: { type: Number, required: true, min: 0 },
          },
        ],
        qcStatus: { type: String, enum: ['pending', 'passed', 'held', 'rejected'], default: 'pending' },
        qcBy: { type: String, default: '' },
        qcAt: { type: Date, default: null },
        qcRemarks: { type: String, default: '' },
      },
    ],
    statusHistory: [
      {
        status: String,
        userId: { type: mongoose.SchemaTypes.ObjectId, ref: 'User' },
        userName: { type: String, default: '' },
        at: { type: Date, default: Date.now },
        remarks: { type: String, default: '' },
      },
    ],
  },
  { timestamps: true }
);

const fabricLotSchema = mongoose.Schema(
  {
    poId: { type: mongoose.SchemaTypes.ObjectId, ref: 'PurchaseOrder', required: true },
    status: { type: String, enum: ['pending-cutoff', 'approved', 'rejected'], default: 'pending-cutoff' },
    qcStatus: { type: String, enum: ['pending', 'passed', 'held'], default: 'pending' },
    cutoffs: [{ fabricId: String, approved: { type: Boolean, default: false } }],
  },
  { timestamps: true }
);

const packingListSchema = mongoose.Schema(
  {
    lotId: { type: mongoose.SchemaTypes.ObjectId, ref: 'FabricLot', required: true },
    packingListCode: { type: String, required: true },
    shipmentDate: { type: Date, required: true },
    expectedDelivery: { type: Date, required: true },
    fabricName: { type: String, default: '' },
    rolls: { type: Number, default: 0 },
    quantity: { type: Number, default: 0 },
    weight: { type: Number, default: 0 },
    boxes: { type: Number, default: 0 },
    courierName: { type: String, default: '' },
    courierNumber: { type: String, default: '' },
    vehicleNumber: { type: String, default: '' },
    challanNumber: { type: String, default: '' },
    notes: { type: String, default: '' },
    lineIds: [{ type: String }],
    files: [
      {
        url: String,
        key: String,
        originalName: String,
        mimeType: String,
        size: Number,
      },
    ],
  },
  { timestamps: true }
);

const goodsReceiptSchema = mongoose.Schema(
  {
    number: { type: String, required: true, unique: true },
    eventId: { type: String, unique: true, sparse: true },
    lotId: { type: mongoose.SchemaTypes.ObjectId, ref: 'FabricLot', required: true },
    poId: { type: mongoose.SchemaTypes.ObjectId, ref: 'PurchaseOrder', required: true },
    receivedDate: { type: Date, default: Date.now },
    netWeight: { type: Number, default: 0 },
    grossWeight: { type: Number, default: 0 },
    condition: { type: String, default: '' },
    receiver: { type: String, default: '' },
    supplierName: { type: String, default: '' },
    supplierAddress: { type: String, default: '' },
    supplierTerms: { type: String, default: '' },
    notes: { type: String, default: '' },
  },
  { timestamps: true }
);

const fabricRollSchema = mongoose.Schema(
  {
    barcode: { type: String, required: true, unique: true },
    lotId: { type: mongoose.SchemaTypes.ObjectId, ref: 'FabricLot', required: true },
    grnId: { type: mongoose.SchemaTypes.ObjectId, ref: 'GoodsReceipt', required: true },
    poId: { type: mongoose.SchemaTypes.ObjectId, ref: 'PurchaseOrder', required: true },
    fabricId: { type: String, default: '' },
    lineId: { type: String, default: '' },
    fabricName: { type: String, default: '' },
    colourName: { type: String, default: '' },
    receivedLotNumber: { type: String, default: '' },
    rollCode: { type: String, default: '' },
    grossWeight: { type: Number, default: 0, min: 0 },
    netWeight: { type: Number, default: 0, min: 0 },
    scaleWeight: { type: Number, required: true },
    condition: { type: String, default: 'good' },
    rate: { type: Number, default: 0 },
    gstPercent: { type: Number, default: 0 },
    qcStatus: { type: String, enum: ['pending', 'passed', 'rejected', 'held'], default: 'pending' },
    status: {
      type: String,
      enum: ['received', 'stored', 'qc-passed', 'lot-held', 'issued', 'on-floor', 'returned', 'returned-to-vendor'],
      default: 'received',
    },
  },
  { timestamps: true }
);

const stockMovementSchema = mongoose.Schema(
  {
    eventId: { type: String, unique: true, sparse: true },
    entityType: { type: String, enum: ['roll', 'box'], required: true },
    entityId: { type: String, required: true },
    kind: { type: String, required: true },
    fromLocation: { type: String, default: '' },
    toLocation: { type: String, default: '' },
    quantity: { type: Number, default: 1 },
  },
  { timestamps: true }
);

const vendorReturnSchema = mongoose.Schema(
  {
    poId: { type: mongoose.SchemaTypes.ObjectId, ref: 'PurchaseOrder', required: true },
    grnId: { type: mongoose.SchemaTypes.ObjectId, ref: 'GoodsReceipt', required: true },
    reason: { type: String, enum: ['rejected', 'excess', 'wrong'], required: true },
    rollBarcodes: [{ type: String }],
    lotNumbers: [{ type: String }],
    quantity: { type: Number, default: 0 },
    weight: { type: Number, default: 0 },
    challanNumber: { type: String, default: '' },
    poNumber: { type: String, default: '' },
    supplierName: { type: String, default: '' },
    remarks: { type: String, default: '' },
    issuedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

for (const schema of [
  purchaseOrderSchema,
  fabricLotSchema,
  packingListSchema,
  goodsReceiptSchema,
  fabricRollSchema,
  stockMovementSchema,
  vendorReturnSchema,
]) {
  schema.plugin(toJSON);
}

export const PurchaseOrder = mongoose.model('PurchaseOrder', purchaseOrderSchema);
export const FabricLot = mongoose.model('FabricLot', fabricLotSchema);
export const PackingList = mongoose.model('PackingList', packingListSchema);
export const GoodsReceipt = mongoose.model('GoodsReceipt', goodsReceiptSchema);
export const FabricRoll = mongoose.model('FabricRoll', fabricRollSchema);
export const StockMovement = mongoose.model('StockMovement', stockMovementSchema);
export const VendorReturn = mongoose.model('VendorReturn', vendorReturnSchema);
