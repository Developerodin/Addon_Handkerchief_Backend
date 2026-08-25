import mongoose from 'mongoose';
import { toJSON, paginate } from './plugins/index.js';

const fabricYarnCountSchema = mongoose.Schema(
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

fabricYarnCountSchema.index({ name: 1 }, { unique: true });
fabricYarnCountSchema.plugin(toJSON);
fabricYarnCountSchema.plugin(paginate);

const FabricYarnCount = mongoose.model('FabricYarnCount', fabricYarnCountSchema);

export default FabricYarnCount;
