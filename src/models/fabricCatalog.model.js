import mongoose from 'mongoose';
import { toJSON, paginate } from './plugins/index.js';

const fabricCatalogSchema = mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    fabricSortNo: {
      type: String,
      trim: true,
      default: '',
    },
    millOldFabricSortNo: {
      type: String,
      trim: true,
      default: '',
    },
    millNewFabricSortNo: {
      type: String,
      trim: true,
      default: '',
    },
    fabricType: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'FabricType',
      default: null,
    },
    fabricTypeName: {
      type: String,
      trim: true,
      default: '',
    },
    color: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'FabricColor',
      default: null,
    },
    colourName: {
      type: String,
      trim: true,
      default: '',
    },
    quality: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'FabricQuality',
      default: null,
    },
    qualityName: {
      type: String,
      trim: true,
      default: '',
    },
    yarn: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'FabricYarn',
      default: null,
    },
    yarnName: {
      type: String,
      trim: true,
      default: '',
    },
    count: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'FabricCount',
      default: null,
    },
    countName: {
      type: String,
      trim: true,
      default: '',
    },
    construction: {
      type: String,
      trim: true,
      default: '',
    },
    weave: {
      type: String,
      trim: true,
      default: '',
    },
    design: {
      type: String,
      enum: ['', 'Plain', 'Print'],
      default: '',
    },
    wash: {
      type: String,
      enum: ['', 'Yes', 'No'],
      default: '',
    },
    finish: {
      type: String,
      enum: ['', 'NA', 'N9', 'Silverdor', 'Anti Micobacterial'],
      default: '',
    },
    glm: {
      type: Number,
      min: 0,
      default: 0,
    },
    glmMeasurement: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'FabricMeasurement',
      default: null,
    },
    glmMeasurementName: {
      type: String,
      trim: true,
      default: '',
    },
    finishedWidth: {
      type: Number,
      min: 0,
      default: 0,
    },
    finishedWidthMeasurement: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'FabricMeasurement',
      default: null,
    },
    finishedWidthMeasurementName: {
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
fabricCatalogSchema.index({ fabricSortNo: 1 }, { unique: true, sparse: true });
fabricCatalogSchema.index({ fabricType: 1 });
fabricCatalogSchema.index({ color: 1 });
fabricCatalogSchema.index({ quality: 1 });
fabricCatalogSchema.index({ yarn: 1 });
fabricCatalogSchema.index({ count: 1 });

fabricCatalogSchema.plugin(toJSON);
fabricCatalogSchema.plugin(paginate);

const FabricCatalog = mongoose.model('FabricCatalog', fabricCatalogSchema);

export default FabricCatalog;
