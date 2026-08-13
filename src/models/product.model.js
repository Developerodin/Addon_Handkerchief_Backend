import mongoose from 'mongoose';
import { toJSON, paginate } from './plugins/index.js';

const fabricBomItemSchema = mongoose.Schema({
  fabricCatalogId: {
    type: mongoose.SchemaTypes.ObjectId,
    ref: 'FabricCatalog',
    required: false,
  },
  fabricName: {
    type: String,
    trim: true,
    required: false,
  },
  /** Metres per piece */
  quantity: {
    type: Number,
    required: false,
    min: 0,
  },
  unitCost: {
    type: Number,
    min: 0,
    default: 0,
  },
});

const processItemSchema = mongoose.Schema({
  processId: {
    type: mongoose.SchemaTypes.ObjectId,
    ref: 'Process',
  },
});

const packagingBomItemSchema = mongoose.Schema({
  rawMaterialId: {
    type: mongoose.SchemaTypes.ObjectId,
    ref: 'RawMaterial',
  },
  quantity: {
    type: Number,
    min: 0,
    default: 0,
  },
  unitCost: {
    type: Number,
    min: 0,
    default: 0,
  },
});

const productSchema = mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    softwareCode: {
      type: String,
      required: false,
      trim: true,
      unique: true,
      sparse: true,
    },
    internalCode: {
      type: String,
      required: false,
      trim: true,
    },
    articleName: {
      type: String,
      trim: true,
      default: '',
    },
    vendorCode: {
      type: String,
      required: false,
      trim: true,
    },
    factoryCode: {
      type: String,
      required: false,
      trim: true,
    },
    hsnCode: {
      type: String,
      trim: true,
      default: '',
    },
    gst: {
      type: String,
      trim: true,
      default: '',
    },
    /** Legacy knitting field kept optional */
    knittingCode: {
      type: String,
      required: false,
      trim: true,
      default: '',
    },
    styleCodes: [
      {
        type: mongoose.SchemaTypes.ObjectId,
        ref: 'StyleCode',
        required: false,
      },
    ],
    productionType: {
      type: String,
      enum: ['normal', 'embroidery', 'internal', 'outsourced'],
      default: 'normal',
      required: true,
    },
    description: {
      type: String,
      required: false,
      trim: true,
      default: '',
    },
    category: {
      type: mongoose.SchemaTypes.ObjectId,
      ref: 'Category',
      required: true,
    },
    image: {
      type: String,
      trim: true,
    },
    attributes: {
      type: Map,
      of: String,
      default: {},
    },
    bom: [fabricBomItemSchema],
    processes: [processItemSchema],
    rawMaterials: [packagingBomItemSchema],
    unitCost: {
      type: Number,
      min: 0,
      default: 0,
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

productSchema.pre('save', async function syncBomNames(next) {
  const FabricCatalog = mongoose.models.FabricCatalog;
  if (FabricCatalog && this.bom && Array.isArray(this.bom)) {
    for (const bomItem of this.bom) {
      if (!bomItem.fabricCatalogId) continue;
      try {
        const fabric = await FabricCatalog.findById(bomItem.fabricCatalogId).select('name rate').lean();
        if (fabric?.name) bomItem.fabricName = fabric.name;
        if (!bomItem.unitCost && fabric?.rate) bomItem.unitCost = fabric.rate;
      } catch (error) {
        console.error('Error syncing fabricName from fabricCatalogId:', error);
      }
    }
  }

  let rollup = 0;
  for (const bomItem of this.bom || []) {
    rollup += (Number(bomItem.quantity) || 0) * (Number(bomItem.unitCost) || 0);
  }
  for (const line of this.rawMaterials || []) {
    rollup += (Number(line.quantity) || 0) * (Number(line.unitCost) || 0);
  }
  this.unitCost = Math.round(rollup * 100) / 100;
  next();
});

productSchema.plugin(toJSON);
productSchema.plugin(paginate);

const Product = mongoose.model('Product', productSchema);

export default Product;
