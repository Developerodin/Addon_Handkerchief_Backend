import mongoose from 'mongoose';
import { toJSON, paginate } from './plugins/index.js';

const styleCodeComboSchema = mongoose.Schema(
  {
    comboCode: {
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
      default: '',
    },
    pack: {
      type: String,
      trim: true,
      default: '',
    },
    components: [
      {
        styleCode: {
          type: mongoose.SchemaTypes.ObjectId,
          ref: 'StyleCode',
          required: true,
        },
        quantity: {
          type: Number,
          required: true,
          min: 1,
          default: 1,
        },
      },
    ],
    status: {
      type: String,
      enum: ['active', 'inactive'],
      default: 'active',
    },
  },
  {
    timestamps: true,
  }
);

styleCodeComboSchema.plugin(toJSON);
styleCodeComboSchema.plugin(paginate);

const StyleCodeCombo = mongoose.model('StyleCodeCombo', styleCodeComboSchema);

export default StyleCodeCombo;
