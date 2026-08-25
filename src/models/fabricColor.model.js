import mongoose from 'mongoose';
import { toJSON, paginate } from './plugins/index.js';

const fabricColorSchema = mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    colorCode: {
      type: String,
      required: true,
      trim: true,
    },
    pantone: {
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

fabricColorSchema.index({ name: 1 }, { unique: true });
fabricColorSchema.plugin(toJSON);
fabricColorSchema.plugin(paginate);

const FabricColor = mongoose.model('FabricColor', fabricColorSchema);

export default FabricColor;
