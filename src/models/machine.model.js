import mongoose from 'mongoose';
import { toJSON, paginate } from './plugins/index.js';
import { PROCESS_DEPARTMENTS, PROCESS_MACHINE_TYPES } from './process.model.js';

const machineSchema = mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    code: { type: String, trim: true, uppercase: true, default: '' },
    machineType: {
      type: String,
      enum: [...PROCESS_MACHINE_TYPES.filter((t) => t !== 'none'), ''],
      default: '',
    },
    makeModel: { type: String, trim: true, default: '' },
    department: {
      type: String,
      enum: [...PROCESS_DEPARTMENTS, ''],
      default: '',
    },
    floor: { type: String, trim: true, default: '' },
    capacityPerShift: { type: Number, min: 0, default: 0 },
    maintenanceIntervalMonths: { type: Number, min: 0, default: 3 },
    lastMaintenanceDate: { type: Date, default: null },
    nextMaintenanceDate: { type: Date, default: null },
    maintenanceNotes: { type: String, trim: true, default: '' },
    assignedSupervisor: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'User',
      default: null,
    },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
  },
  { timestamps: true }
);

machineSchema.index({ code: 1 }, { unique: true, sparse: true });
machineSchema.plugin(toJSON);
machineSchema.plugin(paginate);

const Machine = mongoose.model('Machine', machineSchema);
export default Machine;
