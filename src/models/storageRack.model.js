import mongoose from 'mongoose';
import { toJSON, paginate } from './plugins/index.js';

export const STOCK_TYPES = ['fabric', 'wip-bundle', 'finished-carton'];

const storageRackSchema = mongoose.Schema(
  {
    code: { type: String, required: true, trim: true, uppercase: true },
    name: { type: String, required: true, trim: true },
    floor: { type: String, trim: true, default: '' },
    zone: { type: String, trim: true, default: '' },
    stockType: {
      type: String,
      enum: STOCK_TYPES,
      default: 'fabric',
    },
    capacity: { type: Number, min: 0, default: 0 },
    barcode: { type: String, trim: true, default: '' },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
  },
  { timestamps: true }
);

storageRackSchema.index({ code: 1 }, { unique: true });
storageRackSchema.pre('save', function setBarcode(next) {
  if (!this.barcode && this.code) {
    this.barcode = this.code;
  }
  next();
});
storageRackSchema.plugin(toJSON);
storageRackSchema.plugin(paginate);

const StorageRack = mongoose.model('StorageRack', storageRackSchema);
export default StorageRack;
