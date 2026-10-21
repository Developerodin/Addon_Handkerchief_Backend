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
    revisionId: { type: String, default: '' },
    onPackingRack: { type: Boolean, default: false },
  },
  { timestamps: true }
);

const dispatchBoxSchema = mongoose.Schema(
  {
    barcode: { type: String, required: true, unique: true },
    eventId: { type: String, unique: true, sparse: true },
    clientOrderId: { type: mongoose.SchemaTypes.ObjectId, ref: 'ClientOrder' },
    productionOrderId: { type: mongoose.SchemaTypes.ObjectId, ref: 'ProductionOrder' },
    revisionId: { type: String, default: '' },
    packingBundleIds: [{ type: String }],
    scaleWeight: { type: Number, default: 0 },
    rackCode: { type: String, default: '' },
    status: { type: String, enum: ['open', 'on-rack', 'dispatched'], default: 'open' },
    clientAddress: { type: String, default: '' },
    rollBarcode: { type: String, default: '' },
    poId: { type: String, default: '' },
  },
  { timestamps: true }
);

for (const schema of [clientSchema, clientOrderSchema, packingBundleSchema, dispatchBoxSchema]) {
  schema.plugin(toJSON);
}

export const FactoryClient = mongoose.model('FactoryClient', clientSchema);
export const ClientOrder = mongoose.model('ClientOrder', clientOrderSchema);
export const PackingBundle = mongoose.model('PackingBundle', packingBundleSchema);
export const DispatchBox = mongoose.model('DispatchBox', dispatchBoxSchema);
