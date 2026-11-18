import mongoose from 'mongoose';
import { toJSON, paginate } from './plugins/index.js';

export const PRODUCTION_STOCK_TYPES = [
  'wip-bundle',
  'finished-carton',
  'floor-roll',
  'pieces',
  'bundles',
  'waiting-embroidery',
  'waiting-sticker',
  'long-alteration',
  'alteration',
  'rejection',
  'packing',
  'box',
];

const productionRackSchema = mongoose.Schema(
  {
    code: { type: String, required: true, trim: true, uppercase: true },
    name: { type: String, required: true, trim: true },
    location: { type: String, trim: true, uppercase: true, default: '' },
    floor: { type: String, trim: true, default: 'production' },
    zone: { type: String, trim: true, default: '' },
    stockType: {
      type: String,
      enum: PRODUCTION_STOCK_TYPES,
      default: 'bundles',
    },
    capacity: { type: Number, min: 0, default: 0 },
    barcode: { type: String, trim: true, default: '' },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
  },
  { timestamps: true }
);

productionRackSchema.index({ code: 1 }, { unique: true });
productionRackSchema.pre('save', function setBarcode(next) {
  if (!this.barcode && this.code) {
    this.barcode = this.code;
  }
  next();
});
productionRackSchema.plugin(toJSON);
productionRackSchema.plugin(paginate);

const ProductionRack = mongoose.model('ProductionRack', productionRackSchema);
export default ProductionRack;