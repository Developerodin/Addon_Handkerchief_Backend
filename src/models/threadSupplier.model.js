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

const threadDetailSchema = mongoose.Schema(
  {
    threadCatalogId: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'ThreadCatalog',
      required: true,
    },
    threadCode: {
      type: String,
      trim: true,
      default: '',
    },
    threadType: {
      type: String,
      trim: true,
      default: '',
    },
  },
  { _id: false }
);

const threadSupplierSchema = mongoose.Schema(
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
    threadDetails: {
      type: [threadDetailSchema],
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

threadSupplierSchema.index({ name: 1 });

threadSupplierSchema.plugin(toJSON);
threadSupplierSchema.plugin(paginate);

const ThreadSupplier = mongoose.model('ThreadSupplier', threadSupplierSchema);

export default ThreadSupplier;
