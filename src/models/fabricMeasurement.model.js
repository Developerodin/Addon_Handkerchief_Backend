import mongoose from 'mongoose';
import { toJSON, paginate } from './plugins/index.js';

export const MEASUREMENT_CATEGORIES = ['length', 'weight', 'quantity', 'area'];

const fabricMeasurementSchema = mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    symbol: {
      type: String,
      trim: true,
      default: '',
    },
    category: {
      type: String,
      enum: MEASUREMENT_CATEGORIES,
      required: true,
    },
    status: {
      type: String,
      enum: ['active', 'inactive'],
      default: 'active',
    },
  },
  { timestamps: true }
);

fabricMeasurementSchema.index({ name: 1, category: 1 }, { unique: true });
fabricMeasurementSchema.plugin(toJSON);
fabricMeasurementSchema.plugin(paginate);

const FabricMeasurement = mongoose.model('FabricMeasurement', fabricMeasurementSchema);

export default FabricMeasurement;
