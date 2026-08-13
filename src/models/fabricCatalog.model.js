import mongoose from 'mongoose';
import { toJSON, paginate } from './plugins/index.js';

const fabricCatalogSchema = mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    code: {
      type: String,
      trim: true,
      uppercase: true,
      default: '',
    },
    fabricType: {
      type: String,
      trim: true,
      default: '',
    },
    composition: {
      type: String,
      trim: true,
      default: '',
    },
    gsm: {
      type: Number,
      min: 0,
      default: 0,
    },
    width: {
      type: Number,
      min: 0,
      default: 0,
    },
    colour: {
      type: String,
      trim: true,
      default: '',
    },
    shade: {
      type: String,
      trim: true,
      default: '',
    },
    pantone: {
      type: String,
      trim: true,
      default: '',
    },
    design: {
      type: String,
      trim: true,
      default: '',
    },
    rate: {
      type: Number,
      min: 0,
      default: 0,
    },
    gst: {
      type: String,
      trim: true,
      default: '',
    },
    hsnCode: {
      type: String,
      trim: true,
      default: '',
    },
    minQuantity: {
      type: Number,
      min: 0,
      default: 0,
    },
    supplier: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'FabricSupplier',
      default: null,
    },
    supplierName: {
      type: String,
      trim: true,
      default: '',
    },
    /** Unit of measure notes: rolls + kg + metres */
    uomRolls: {
      type: Boolean,
      default: true,
    },
    uomKg: {
      type: Boolean,
      default: true,
    },
    uomMetres: {
      type: Boolean,
      default: true,
    },
    status: {
      type: String,
      enum: ['active', 'inactive'],
      default: 'active',
    },
    remark: {
      type: String,
      trim: true,
      default: '',
    },
  },
  {
    timestamps: true,
  }
);

fabricCatalogSchema.index({ name: 1 });
fabricCatalogSchema.index({ code: 1 }, { unique: true, sparse: true });

fabricCatalogSchema.plugin(toJSON);
fabricCatalogSchema.plugin(paginate);

const FabricCatalog = mongoose.model('FabricCatalog', fabricCatalogSchema);

export default FabricCatalog;
