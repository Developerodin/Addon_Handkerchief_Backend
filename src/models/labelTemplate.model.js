import mongoose from 'mongoose';
import { toJSON, paginate } from './plugins/index.js';

export const LABEL_TYPES = ['fabric-roll', 'bundle-sticker', 'carton', 'style-ean'];

const labelTemplateSchema = mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    labelType: {
      type: String,
      enum: LABEL_TYPES,
      required: true,
    },
    size: { type: String, trim: true, default: '' },
    encodedFields: [{ type: String, trim: true }],
    barcodeScheme: { type: String, trim: true, default: '' },
    printerDevice: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'DeviceRegistry',
      default: null,
    },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
  },
  { timestamps: true }
);

labelTemplateSchema.plugin(toJSON);
labelTemplateSchema.plugin(paginate);

const LabelTemplate = mongoose.model('LabelTemplate', labelTemplateSchema);
export default LabelTemplate;
