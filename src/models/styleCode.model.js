import mongoose from 'mongoose';
import { toJSON, paginate } from './plugins/index.js';

const styleCodeSchema = mongoose.Schema(
  {
    styleCode: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    },
    eanCode: {
      type: String,
      required: true,
      trim: true,
    },
    mrp: {
      type: Number,
      required: true,
      min: 0,
    },
    brand: {
      type: String,
      trim: true,
    },
    pack: {
      type: String,
      trim: true,
    },
    /** Bundle configuration — default 60 pcs */
    bundleQty: {
      type: Number,
      min: 1,
      default: 60,
    },
    /** Carton configuration — default 120 pcs */
    cartonQty: {
      type: Number,
      min: 1,
      default: 120,
    },
    /** Pieces in one packing bundle. 60 to 120. */
    packingBundleQty: {
      type: Number,
      min: 60,
      max: 120,
      default: 60,
    },
    linkedItem: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Product',
      default: null,
    },
    status: {
      type: String,
      enum: ['active', 'inactive'],
      default: 'active',
    },
    bom: [
      {
        rawMaterial: { type: mongoose.Schema.Types.ObjectId, ref: 'RawMaterial', required: false },
        quantity: { type: Number, required: false, min: 0 },
      },
    ],
  },
  {
    timestamps: true,
  }
);

styleCodeSchema.plugin(toJSON);
styleCodeSchema.plugin(paginate);

const StyleCode = mongoose.model('StyleCode', styleCodeSchema);

export default StyleCode;
