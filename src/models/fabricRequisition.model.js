import mongoose from 'mongoose';
import { toJSON } from './plugins/index.js';

const fabricRequisitionSchema = mongoose.Schema(
  {
    fabricCatalogId: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'FabricCatalog',
      required: true,
    },
    fabricName: { type: String, trim: true, default: '' },
    fabricSortNo: { type: String, trim: true, default: '' },
    colourName: { type: String, trim: true, default: '' },
    /** Catalog minimum at the last reconcile, in metres. */
    minQty: { type: Number, required: true, min: 0 },
    /** Stored + QC-passed metres at the last reconcile. */
    onHandMeters: { type: Number, required: true, min: 0, default: 0 },
    poSent: { type: Boolean, default: false },
    draftForPo: { type: Boolean, default: false },
    preferredSupplierId: { type: mongoose.SchemaTypes.ObjectId, ref: 'FabricSupplier' },
    preferredSupplierName: { type: String, trim: true, default: '' },
    dismissed: { type: Boolean, default: false },
    dismissedAt: { type: Date },
    /** Set once stock rises above the minimum, so the next drop can open a new row. */
    stockRecovered: { type: Boolean, default: false },
    linkedPurchaseOrderId: { type: mongoose.SchemaTypes.ObjectId, ref: 'PurchaseOrder' },
    attachedDraftPoId: { type: mongoose.SchemaTypes.ObjectId, ref: 'PurchaseOrder' },
  },
  { timestamps: true }
);

fabricRequisitionSchema.index({ fabricCatalogId: 1, poSent: 1, dismissed: 1 });
fabricRequisitionSchema.index({ dismissed: 1, createdAt: -1 });
fabricRequisitionSchema.index({ attachedDraftPoId: 1 });
fabricRequisitionSchema.index({ linkedPurchaseOrderId: 1 });

fabricRequisitionSchema.plugin(toJSON);

const FabricRequisition = mongoose.model('FabricRequisition', fabricRequisitionSchema);

export default FabricRequisition;
