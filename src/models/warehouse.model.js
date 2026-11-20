import mongoose from 'mongoose';
import { toJSON } from './plugins/index.js';

const clientSchema = mongoose.Schema(
  {
    name: { type: String, required: true },
    address: { type: String, default: '' },
  },
  { timestamps: true }
);

const clientOrderSchema = mongoose.Schema(
  {
    clientId: { type: mongoose.SchemaTypes.ObjectId, ref: 'FactoryClient', required: true },
    clientName: { type: String, required: true },
    clientAddress: { type: String, default: '' },
    status: {
      type: String,
      enum: ['open', 'partially-dispatched', 'dispatched'],
      default: 'open',
    },
    targetBoxes: { type: Number, default: 1 },
  },
  { timestamps: true }
);

const packingBundleSchema = mongoose.Schema(
  {
    barcode: { type: String, required: true, unique: true },
    orderId: { type: mongoose.SchemaTypes.ObjectId, ref: 'ProductionOrder' },
    clientOrderId: { type: mongoose.SchemaTypes.ObjectId, ref: 'ClientOrder' },
    qty: { type: Number, required: true, min: 1 },
    pieceBundleBarcode: { type: String, default: '' },
    boxBarcode: { type: String, default: '' },
    revisionId: { type: String, default: '' },
    onPackingRack: { type: Boolean, default: false },
    scaleWeight: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

const dispatchBoxSchema = mongoose.Schema(
  {
    barcode: { type: String, required: true, unique: true },
    eventId: { type: String, unique: true, sparse: true },
    clientOrderId: { type: mongoose.SchemaTypes.ObjectId, ref: 'ClientOrder' },
    productionOrderId: { type: mongoose.SchemaTypes.ObjectId, ref: 'ProductionOrder' },
    orderNumber: { type: String, default: '' },
    revisionId: { type: String, default: '' },
    packingBundleIds: [{ type: String }],
    pieceQty: { type: Number, default: 0, min: 0 },
    scaleWeight: { type: Number, default: 0 },
    rackCode: { type: String, default: '' },
    vehicleNumber: { type: String, default: '' },
    status: {
      type: String,
      enum: ['open', 'weighed', 'ready-for-dispatch', 'on-rack', 'dispatched'],
      default: 'open',
    },
    clientAddress: { type: String, default: '' },
    rollBarcode: { type: String, default: '' },
    poId: { type: String, default: '' },
    dispatchShipmentId: { type: mongoose.SchemaTypes.ObjectId, ref: 'DispatchShipment', default: null },
  },
  { timestamps: true }
);

const shipmentBoxLineSchema = mongoose.Schema(
  {
    boxBarcode: { type: String, required: true },
    pieceQty: { type: Number, default: 0, min: 0 },
    scaleWeight: { type: Number, default: 0, min: 0 },
    rackCode: { type: String, default: '' },
    addedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const dispatchShipmentSchema = mongoose.Schema(
  {
    shipmentCode: { type: String, required: true, unique: true },
    challanNumber: { type: String, default: '' },
    productionOrderId: { type: mongoose.SchemaTypes.ObjectId, ref: 'ProductionOrder', required: true },
    orderNumber: { type: String, default: '' },
    buyer: { type: String, default: '' },
    status: { type: String, enum: ['draft', 'dispatched', 'cancelled'], default: 'draft' },
    vehicleNumber: { type: String, default: '' },
    boxLines: [shipmentBoxLineSchema],
    boxCount: { type: Number, default: 0, min: 0 },
    pieceQty: { type: Number, default: 0, min: 0 },
    scaleWeight: { type: Number, default: 0, min: 0 },
    dispatchedAt: { type: Date, default: null },
    dispatchedBy: { type: String, default: '' },
  },
  { timestamps: true }
);

for (const schema of [clientSchema, clientOrderSchema, packingBundleSchema, dispatchBoxSchema, dispatchShipmentSchema]) {
  schema.plugin(toJSON);
}

export const FactoryClient = mongoose.model('FactoryClient', clientSchema);
export const ClientOrder = mongoose.model('ClientOrder', clientOrderSchema);
export const PackingBundle = mongoose.model('PackingBundle', packingBundleSchema);
export const DispatchBox = mongoose.model('DispatchBox', dispatchBoxSchema);
export const DispatchShipment = mongoose.model('DispatchShipment', dispatchShipmentSchema);
