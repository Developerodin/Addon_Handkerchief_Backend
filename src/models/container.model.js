import mongoose from 'mongoose';
import { toJSON, paginate } from './plugins/index.js';
import { PROCESS_DEPARTMENTS } from './process.model.js';

export const CONTAINER_TYPES = ['bundle', 'carton', 'trolley', 'crate'];

const containerSchema = mongoose.Schema(
  {
    code: { type: String, required: true, trim: true, uppercase: true },
    name: { type: String, required: true, trim: true },
    type: {
      type: String,
      enum: CONTAINER_TYPES,
      default: 'bundle',
    },
    capacity: { type: Number, min: 0, default: 0 },
    barcode: { type: String, trim: true, default: '' },
    department: {
      type: String,
      enum: [...PROCESS_DEPARTMENTS, ''],
      default: '',
    },
    floor: { type: String, trim: true, default: '' },
    reusable: { type: Boolean, default: true },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
  },
  { timestamps: true }
);

containerSchema.index({ code: 1 }, { unique: true });
containerSchema.pre('save', function setBarcode(next) {
  if (!this.barcode && this._id) {
    this.barcode = String(this._id);
  }
  next();
});
containerSchema.plugin(toJSON);
containerSchema.plugin(paginate);

const Container = mongoose.model('Container', containerSchema);
export default Container;
