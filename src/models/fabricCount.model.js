import mongoose from 'mongoose';
import { toJSON, paginate } from './plugins/index.js';

const fabricCountSchema = mongoose.Schema(
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

fabricCountSchema.index({ name: 1 }, { unique: true });
fabricCountSchema.plugin(toJSON);
fabricCountSchema.plugin(paginate);

const FabricCount = mongoose.model('FabricCount', fabricCountSchema);

export default FabricCount;
