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

const fabricSnapSchema = mongoose.Schema(
  {
    bomLineId: { type: String, default: '' },
    fabricCatalogId: { type: String, default: '' },
    fabricName: { type: String, default: '' },
    metresPerPiece: { type: Number, default: 0, min: 0 },
    unitCost: { type: Number, default: 0, min: 0 },
  },
  { _id: false }
);

const materialSnapSchema = mongoose.Schema(
  {
    lineId: { type: String, default: '' },
    materialRole: { type: String, default: '' },
    quantity: { type: Number, default: 0, min: 0 },
    rawMaterialId: { type: String, default: '' },
  },
  { _id: false }
);

const snapshotSchema = mongoose.Schema(
  {
    fabricBom: { type: [fabricSnapSchema], default: [] },
    threadLines: { type: [materialSnapSchema], default: [] },
    packingLines: { type: [materialSnapSchema], default: [] },
    piecesPerCut: { type: Number, enum: [3, 4], default: 3 },
    route: { type: String, default: '' },
    rates: {
      type: [new mongoose.Schema({ bomLineId: { type: String, default: '' }, unitCost: { type: Number, default: 0 } }, { _id: false })],
      default: [],
    },
    currency: { type: String, default: 'INR' },
    calculationPolicy: { type: String, default: 'metres-per-piece' },
  },
  { _id: false }
);

const orderLineSchema = mongoose.Schema(
  {
    itemId: { type: mongoose.SchemaTypes.ObjectId, ref: 'Product', required: true },
    articleName: { type: String, default: '' },
    factoryCode: { type: String, default: '' },
    productionType: { type: String, enum: ['normal', 'embroidery', 'sticker'], required: true },
    piecesPerCut: { type: Number, enum: [3, 4], default: 3 },
    quantity: { type: Number, required: true, min: 1 },
    priority: { type: String, enum: ['Urgent', 'High', 'Medium', 'Low'], default: 'Medium' },
    remarks: { type: String, default: '' },
    revisionId: { type: String, default: '' },
    pinId: { type: mongoose.SchemaTypes.ObjectId, default: null },
    scopeId: { type: String, default: '' },
    snapshot: { type: snapshotSchema, default: null },
    fabricIssueStatus: { type: String, enum: ['open', 'completed'], default: 'open' },
    floors: [floorStepSchema],
    segments: [segmentSchema],
  },
  { _id: true }
);

const productionOrderSchema = mongoose.Schema(
  {
    orderNumber: { type: String, unique: true, sparse: true },
    orderDate: { type: Date, default: Date.now },
    buyer: { type: String, default: '' },
    clientOrderId: { type: mongoose.SchemaTypes.ObjectId, ref: 'ClientOrder', default: null },
    requiredBy: { type: Date, default: null },
    itemId: { type: mongoose.SchemaTypes.ObjectId, ref: 'Product' },
    productionType: { type: String, enum: ['normal', 'embroidery', 'sticker'], required: true },
    revisionId: { type: String, default: '' },
    targetQty: { type: Number, required: true, min: 1 },
    status: {
      type: String,
      enum: ['pending', 'released', 'in-progress', 'amended', 'on-hold', 'closed'],
      default: 'released',
    },
    priority: { type: String, enum: ['Urgent', 'High', 'Medium', 'Low'], default: 'Medium' },
    orderNote: { type: String, default: '' },
    currentFloor: { type: String, default: '' },
    floors: [floorStepSchema],
    segments: [segmentSchema],
    lines: [orderLineSchema],
  },
  { timestamps: true }
);

/**
 * Old orders have no lines. Every JSON response still shows one line built from the header.
 * @param {object} line
 * @param {string} [fallbackId]
 */
const shapeLine = (line, fallbackId) => {
  const id = line.id || (line._id != null ? String(line._id) : fallbackId || '');
  const next = {
    ...line,
    id,
    fabricIssueStatus: line.fabricIssueStatus === 'completed' ? 'completed' : 'open',
  };
  delete next._id;
  return next;
};

productionOrderSchema.options.toJSON = {
  /**
   * Fills order number, a synthetic line, and article totals before the shared plugin runs.
   * @param {object} _doc
   * @param {object} ret
   */
  transform(_doc, ret) {
    const lines = Array.isArray(ret.lines) ? ret.lines : [];
    if (!lines.length) {
      ret.lines = [
        shapeLine(
          {
            itemId: ret.itemId,
            articleName: '',
            factoryCode: '',
            productionType: ret.productionType,
            piecesPerCut: 3,
            quantity: ret.targetQty,
            priority: ret.priority || 'Medium',
            remarks: '',
            revisionId: ret.revisionId,
            pinId: null,
            scopeId: '',
            snapshot: null,
            fabricIssueStatus: 'open',
            segments: ret.segments || [],
            floors: ret.floors || [],
          },
          String(ret.id || ret._id || '')
        ),
      ];
    } else {
      ret.lines = lines.map((line) => shapeLine(line));
    }
    ret.articleCount = ret.lines.length;
    ret.totalQty = ret.lines.reduce((sum, line) => sum + (Number(line.quantity) || 0), 0);
    return ret;
  },
};

const floorCompletionSchema = mongoose.Schema(
  {
    eventId: { type: String, required: true, unique: true },
    orderId: { type: mongoose.SchemaTypes.ObjectId, ref: 'ProductionOrder', required: true },
    lineId: { type: mongoose.SchemaTypes.ObjectId, default: null },
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
    lineId: { type: mongoose.SchemaTypes.ObjectId, default: null },
    rollBarcode: { type: String, default: '' },
    bundleId: { type: mongoose.SchemaTypes.ObjectId, ref: 'PieceBundle' },
  },
  { timestamps: true }
);

const pieceBundleSchema = mongoose.Schema(
  {
    orderId: { type: mongoose.SchemaTypes.ObjectId, ref: 'ProductionOrder', required: true },
    lineId: { type: mongoose.SchemaTypes.ObjectId, default: null },
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
