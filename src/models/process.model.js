import mongoose from 'mongoose';
import { toJSON, paginate } from './plugins/index.js';

export const PROCESS_DEPARTMENTS = [
  'store',
  'cutting',
  'hemming',
  'checking',
  'ironing',
  'packing',
  'dispatch',
  'embroidery',
];

export const PROCESS_MACHINE_TYPES = [
  'cutting',
  'half-moon',
  'vertical-hemming',
  'horizontal-hemming',
  'embroidery',
  'ironing',
  'none',
];

const processStepSchema = mongoose.Schema(
  {
    stepTitle: {
      type: String,
      required: true,
      trim: true,
    },
    stepDescription: {
      type: String,
      required: true,
      trim: true,
    },
    duration: {
      type: Number,
      required: true,
    },
  },
  {
    _id: true,
    timestamps: true,
  }
);

const processSchema = mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    code: {
      type: String,
      trim: true,
      default: '',
    },
    type: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      required: true,
      trim: true,
    },
    department: {
      type: String,
      enum: [...PROCESS_DEPARTMENTS, ''],
      default: '',
      trim: true,
    },
    floor: {
      type: String,
      trim: true,
      default: '',
    },
    standardTime: {
      type: Number,
      min: 0,
      default: 0,
    },
    machineType: {
      type: String,
      enum: [...PROCESS_MACHINE_TYPES, ''],
      default: '',
      trim: true,
    },
    standardRate: {
      type: Number,
      min: 0,
      default: 0,
    },
    qcCheckpoint: {
      type: Boolean,
      default: false,
    },
    reworkEligible: {
      type: Boolean,
      default: false,
    },
    sortOrder: {
      type: Number,
      default: 0,
    },
    status: {
      type: String,
      enum: ['active', 'inactive'],
      default: 'active',
    },
    image: {
      type: String,
      trim: true,
    },
    steps: [processStepSchema],
  },
  {
    timestamps: true,
  }
);

processSchema.plugin(toJSON);
processSchema.plugin(paginate);

const Process = mongoose.model('Process', processSchema);

export default Process;
