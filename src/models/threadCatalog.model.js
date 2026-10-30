import mongoose from 'mongoose';
import { toJSON, paginate } from './plugins/index.js';

const threadCatalogSchema = mongoose.Schema(
  {
    threadCode: {
      type: String,
      required: true,
      trim: true,
    },
    threadType: {
      type: String,
      required: true,
      trim: true,
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

threadCatalogSchema.index({ threadCode: 1 }, { unique: true });
threadCatalogSchema.index({ threadType: 1 });

threadCatalogSchema.plugin(toJSON);
threadCatalogSchema.plugin(paginate);

const ThreadCatalog = mongoose.model('ThreadCatalog', threadCatalogSchema);

export default ThreadCatalog;
