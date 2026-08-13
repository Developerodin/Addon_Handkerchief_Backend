import mongoose from 'mongoose';
import { toJSON, paginate } from './plugins/index.js';
import { PROCESS_DEPARTMENTS } from './process.model.js';

const workerSchema = mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    employeeCode: { type: String, required: true, trim: true, uppercase: true },
    department: {
      type: String,
      enum: [...PROCESS_DEPARTMENTS, ''],
      default: '',
    },
    supervisor: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      default: null,
    },
    skill: { type: String, trim: true, default: '' },
    shift: { type: String, trim: true, default: '' },
    contactNumber: { type: String, trim: true, default: '' },
    barcode: { type: String, trim: true, default: '' },
    joinDate: { type: Date, default: null },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
  },
  { timestamps: true }
);

workerSchema.index({ employeeCode: 1 }, { unique: true });
workerSchema.pre('save', function setBarcode(next) {
  if (!this.barcode && this._id) {
    this.barcode = String(this._id);
  }
  next();
});
workerSchema.plugin(toJSON);
workerSchema.plugin(paginate);

const Worker = mongoose.model('Worker', workerSchema);
export default Worker;
