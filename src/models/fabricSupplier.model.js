import mongoose from 'mongoose';
import { toJSON, paginate } from './plugins/index.js';

const bankDetailsSchema = mongoose.Schema(
  {
    bankName: { type: String, trim: true, default: '' },
    accountHolder: { type: String, trim: true, default: '' },
    accountNumber: { type: String, trim: true, default: '' },
    ifsc: { type: String, trim: true, uppercase: true, default: '' },
  },
  { _id: false }
);

const fabricDetailSchema = mongoose.Schema(
  {
    fabricCatalogId: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'FabricCatalog',
      required: true,
    },
    fabricName: {
      type: String,
      trim: true,
      default: '',
    },
    fabricSortNo: {
      type: String,
      trim: true,
      default: '',
    },
    fabricTypeName: {
      type: String,
      trim: true,
      default: '',
    },
    colourName: {
      type: String,
      trim: true,
      default: '',
    },
  },
  { _id: false }
);

const fabricSupplierSchema = mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    contactPerson: {
      type: String,
      required: true,
      trim: true,
    },
    contactNumber: {
      type: String,
      trim: true,
      default: '',
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: '',
    },
    address: {
      type: String,
      required: true,
      trim: true,
    },
    city: {
      type: String,
      trim: true,
      default: '',
    },
    state: {
      type: String,
      trim: true,
      default: '',
    },
    pincode: {
      type: String,
      trim: true,
      default: '',
    },
    country: {
      type: String,
      trim: true,
      default: 'India',
    },
    gstin: {
      type: String,
      trim: true,
      uppercase: true,
      default: '',
    },
    paymentTerms: {
      type: String,
      trim: true,
      default: '',
    },
    fabricMill: {
      type: String,
      trim: true,
      default: '',
    },
    fabricDetails: {
      type: [fabricDetailSchema],
      default: [],
    },
    bankDetails: {
      type: bankDetailsSchema,
      default: () => ({}),
    },
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

fabricSupplierSchema.index({ name: 1 });

fabricSupplierSchema.plugin(toJSON);
fabricSupplierSchema.plugin(paginate);

const FabricSupplier = mongoose.model('FabricSupplier', fabricSupplierSchema);

export default FabricSupplier;
