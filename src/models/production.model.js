import mongoose from 'mongoose';
import { toJSON } from './plugins/index.js';

const segmentSchema = mongoose.Schema(
  {
    revisionId: { type: String, required: true },
    qty: { type: Number, required: true, min: 0 },
    completedQty: { type: Number, default: 0, min: 0 },
  },
  { _id: false }
);

const floorStepSchema = mongoose.Schema(
  {
    processId: { type: String, default: '' },
    name: { type: String, default: '' },
    floor: { type: String, required: true },
    sortOrder: { type: Number, default: 0 },
    receivedQty: { type: Number, default: 0, min: 0 },
    completedQty: { type: Number, default: 0, min: 0 },
    transferredQty: { type: Number, default: 0, min: 0 },
  },
  { _id: false }
);

const productionOrderSchema = mongoose.Schema(
  {
    itemId: { type: mongoose.SchemaTypes.ObjectId, ref: 'Product' },
    productionType: { type: String, enum: ['normal', 'embroidery', 'sticker'], required: true },
    revisionId: { type: String, required: true },
    targetQty: { type: Number, required: true, min: 1 },
    status: { type: String, enum: ['released', 'in-progress', 'amended', 'closed'], default: 'released' },
    priority: { type: String, enum: ['Urgent', 'High', 'Medium', 'Low'], default: 'Medium' },
    orderNote: { type: String, default: '' },
    currentFloor: { type: String, default: '' },
    floors: [floorStepSchema],
    segments: [segmentSchema],
  },
  { timestamps: true }
);

const floorCompletionSchema = mongoose.Schema(
  {
    eventId: { type: String, required: true, unique: true },
    orderId: { type: mongoose.SchemaTypes.ObjectId, ref: 'ProductionOrder', required: true },
    stage: { type: String, required: true },
    qty: { type: Number, required: true, min: 0 },
    machineBarcode: { type: String, default: '' },
    operatorId: { type: String, default: '' },
    site: { type: String, enum: ['factory', 'cloud'], default: 'factory' },
  },
  { timestamps: true }
);

const pieceSchema = mongoose.Schema(
  {
    barcode: { type: String, required: true, unique: true },
    orderId: { type: mongoose.SchemaTypes.ObjectId, ref: 'ProductionOrder', required: true },
    rollBarcode: { type: String, default: '' },
    bundleId: { type: mongoose.SchemaTypes.ObjectId, ref: 'PieceBundle' },
  },
  { timestamps: true }
);

const pieceBundleSchema = mongoose.Schema(
  {
    orderId: { type: mongoose.SchemaTypes.ObjectId, ref: 'ProductionOrder', required: true },
    number: { type: Number, required: true },
    qty: { type: Number, default: 0 },
    closed: { type: Boolean, default: false },
    barcode: { type: String, default: '' },
    fromFloor: { type: String, default: '' },
    toFloor: { type: String, default: '' },
    status: { type: String, enum: ['open', 'closed', 'in-transit', 'received'], default: 'open' },
    checkedGood: { type: Boolean, default: false },
    routeSplit: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true }
);

const threadUseSchema = mongoose.Schema(
  {
    orderId: { type: mongoose.SchemaTypes.ObjectId, ref: 'ProductionOrder', required: true },
    machineBarcode: { type: String, default: '' },
    materialRole: { type: String, enum: ['sewing-thread', 'embroidery-thread'], required: true },
    quantity: { type: Number, required: true, min: 0 },
  },
  { timestamps: true }
);

const orderLogSchema = mongoose.Schema(
  {
    orderId: { type: mongoose.SchemaTypes.ObjectId, ref: 'ProductionOrder' },
    action: { type: String, required: true },
    userId: { type: String, default: '' },
    userName: { type: String, default: '' },
    entityType: { type: String, enum: ['roll', 'bundle', 'box', 'po', 'grn', 'order'], required: true },
    entityCode: { type: String, default: '' },
    quantity: { type: Number, default: 1 },
    fromLocation: { type: String, default: '' },
    toLocation: { type: String, default: '' },
    remarks: { type: String, default: '' },
    at: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

orderLogSchema.index({ orderId: 1, at: -1 });
orderLogSchema.index({ action: 1, at: -1 });

for (const schema of [
  productionOrderSchema,
  floorCompletionSchema,
  pieceSchema,
  pieceBundleSchema,
  threadUseSchema,
  orderLogSchema,
]) {
  schema.plugin(toJSON);
}

export const ProductionOrder = mongoose.model('ProductionOrder', productionOrderSchema);
export const FloorCompletion = mongoose.model('FloorCompletion', floorCompletionSchema);
export const CutPiece = mongoose.model('CutPiece', pieceSchema);
export const PieceBundle = mongoose.model('PieceBundle', pieceBundleSchema);
export const ThreadUse = mongoose.model('ThreadUse', threadUseSchema);
export const ProductionOrderLog = mongoose.model('ProductionOrderLog', orderLogSchema);
