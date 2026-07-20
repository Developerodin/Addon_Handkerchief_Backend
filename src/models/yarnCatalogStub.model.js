import mongoose from 'mongoose';
import { toJSON } from './plugins/index.js';

/**
 * Minimal YarnCatalog stub so Product BOM populate works without the full yarn module.
 */
const yarnCatalogStubSchema = mongoose.Schema(
  {
    yarnName: { type: String, trim: true },
  },
  {
    timestamps: true,
    collection: 'yarncatalogs',
  }
);

yarnCatalogStubSchema.plugin(toJSON);

const YarnCatalog = mongoose.models.YarnCatalog || mongoose.model('YarnCatalog', yarnCatalogStubSchema);

export default YarnCatalog;
