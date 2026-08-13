import mongoose from 'mongoose';
import { toJSON, paginate } from './plugins/index.js';

export const PACKAGING_TYPES = [
  'polybag',
  'carton-120',
  'bundle tag',
  'sticker',
  'insert card',
  'embroidery carton',
  'sewing thread',
  'embroidery thread',
  'other',
];

const rawMaterialSchema = mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    type: { type: String, required: true, trim: true },
    sizeSpec: { type: String, trim: true, default: '' },
    unit: { type: String, required: true, trim: true },
    supplier: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'FabricSupplier',
      default: null,
    },
    supplierName: { type: String, trim: true, default: '' },
    rate: { type: Number, min: 0, default: 0 },
    hsnCode: { type: String, trim: true, default: '' },
    gst: { type: String, trim: true, default: '' },
    minimumStock: { type: Number, min: 0, default: 0 },
    description: { type: String, trim: true, default: '' },
    status: {
      type: String,
      enum: ['active', 'inactive'],
      default: 'active',
    },
    image: { type: String, trim: true, default: null },
    // Legacy fields kept optional for existing documents / imports
    groupName: { type: String, trim: true, default: '' },
    brand: { type: String, trim: true, default: '' },
    countSize: { type: String, trim: true, default: '' },
    material: { type: String, trim: true, default: '' },
    color: { type: String, trim: true, default: '' },
    shade: { type: String, trim: true, default: '' },
    mrp: { type: String, trim: true, default: '' },
    articleNo: { type: String, trim: true, default: '' },
  },
  {
    timestamps: true,
  }
);

rawMaterialSchema.pre('validate', function syncLegacyFields(next) {
  if (!this.sizeSpec && this.countSize) {
    this.sizeSpec = this.countSize;
  }
  if ((this.rate === undefined || this.rate === null) && this.mrp) {
    const parsed = parseFloat(String(this.mrp).replace(/[^0-9.]/g, ''));
    if (!Number.isNaN(parsed)) this.rate = parsed;
  }
  next();
});

rawMaterialSchema.plugin(toJSON);
rawMaterialSchema.plugin(paginate);

const RawMaterial = mongoose.model('RawMaterial', rawMaterialSchema);

export default RawMaterial;
