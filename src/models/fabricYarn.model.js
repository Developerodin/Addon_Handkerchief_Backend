import mongoose from 'mongoose';
import { toJSON, paginate } from './plugins/index.js';

const fabricYarnSchema = mongoose.Schema(
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

fabricYarnSchema.index({ name: 1 }, { unique: true });
fabricYarnSchema.plugin(toJSON);
fabricYarnSchema.plugin(paginate);

const FabricYarn = mongoose.model('FabricYarn', fabricYarnSchema);

export default FabricYarn;
