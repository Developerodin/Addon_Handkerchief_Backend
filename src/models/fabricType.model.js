import mongoose from 'mongoose';
import { toJSON, paginate } from './plugins/index.js';

const fabricTypeSchema = mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      enum: ['active', 'inactive'],
      default: 'active',
    },
  },
  { timestamps: true }
);

fabricTypeSchema.index({ name: 1 }, { unique: true });
fabricTypeSchema.plugin(toJSON);
fabricTypeSchema.plugin(paginate);

const FabricType = mongoose.model('FabricType', fabricTypeSchema);

export default FabricType;
