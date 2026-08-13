import mongoose from 'mongoose';
import { toJSON, paginate } from './plugins/index.js';

const optionValueSchema = mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
  },
  image: {
    type: String,
    trim: true,
  },
  sortOrder: {
    type: Number,
    default: 0,
  },
});

const productAttributeSchema = mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    attributeType: {
      type: String,
      enum: ['Manufacturing', 'Warehouse'],
      default: 'Manufacturing',
    },
    type: {
      type: String,
      required: true,
      enum: ['select', 'radio', 'checkbox', 'text', 'textarea', 'number'],
    },
    sortOrder: {
      type: Number,
      default: 0,
    },
    required: {
      type: Boolean,
      default: false,
    },
    appliesToCategory: [
      {
        type: mongoose.SchemaTypes.ObjectId,
        ref: 'Category',
      },
    ],
    optionValues: [optionValueSchema],
  },
  {
    timestamps: true,
  }
);

productAttributeSchema.plugin(toJSON);
productAttributeSchema.plugin(paginate);

const ProductAttribute = mongoose.model('ProductAttribute', productAttributeSchema);

export default ProductAttribute;
