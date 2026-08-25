import mongoose from 'mongoose';
import { toJSON, paginate } from './plugins/index.js';

const fabricQualitySchema = mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    composition: {
      type: String,
      trim: true,
      default: '',
    },
    primaryFiber: {
      type: String,
      trim: true,
      default: '',
    },
    primaryFiberPercent: {
      type: Number,
      min: 0,
      max: 100,
      default: null,
    },
    secondaryFiber: {
      type: String,
      trim: true,
      default: '',
    },
    secondaryFiberPercent: {
      type: Number,
      min: 0,
      max: 100,
      default: null,
    },
    grade: {
      type: String,
      trim: true,
      default: '',
    },
    remarks: {
      type: String,
      trim: true,
      default: '',
    },
    status: {
      type: String,
      enum: ['active', 'inactive'],
      default: 'active',
    },
  },
  { timestamps: true }
);

fabricQualitySchema.index({ name: 1 }, { unique: true });
fabricQualitySchema.plugin(toJSON);
fabricQualitySchema.plugin(paginate);

const FabricQuality = mongoose.model('FabricQuality', fabricQualitySchema);

export default FabricQuality;
