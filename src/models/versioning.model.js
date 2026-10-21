import mongoose from 'mongoose';
import { toJSON, paginate } from './plugins/index.js';

const lineSchema = new mongoose.Schema(
  {
    lineId: { type: String, required: true },
    quantity: { type: Number, required: true },
    values: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { _id: false }
);

const scopeStateSchema = new mongoose.Schema(
  {
    scopeId: { type: String, required: true, unique: true, trim: true },
    effectiveRevisionId: { type: mongoose.Schema.Types.ObjectId, default: null },
    lockVersion: { type: Number, required: true, default: 0 },
    sequence: { type: Number, required: true, default: 0 },
    effectiveState: {
      lines: { type: [lineSchema], default: [] },
    },
  },
  { timestamps: true }
);

const revisionSchema = new mongoose.Schema(
  {
    scopeId: { type: String, required: true, index: true },
    sequence: { type: Number, required: true },
    baseRevisionId: { type: mongoose.Schema.Types.ObjectId, default: null },
    deltas: { type: [mongoose.Schema.Types.Mixed], required: true },
    schemaVersion: { type: Number, required: true, default: 1 },
    canonicalizationVersion: { type: Number, required: true, default: 1 },
    dependencyPins: {
      type: [{ componentScopeId: String, revisionId: String }],
      default: [],
    },
    changeSetHash: { type: String, required: true },
    resultStateHash: { type: String, required: true },
    reason: { type: String, default: '' },
    actorId: { type: mongoose.Schema.Types.ObjectId, default: null },
  },
  { timestamps: true }
);

revisionSchema.index({ scopeId: 1, sequence: 1 }, { unique: true });

const checkpointSchema = new mongoose.Schema(
  {
    scopeId: { type: String, required: true, index: true },
    revisionId: { type: mongoose.Schema.Types.ObjectId, required: true },
    sequence: { type: Number, required: true },
    state: { lines: { type: [lineSchema], default: [] } },
    checksum: { type: String, required: true },
    formatVersion: { type: Number, required: true, default: 1 },
    status: { type: String, enum: ['BUILDING', 'READY', 'FAILED'], required: true },
  },
  { timestamps: true }
);

const changeRequestSchema = new mongoose.Schema(
  {
    scopeId: { type: String, required: true, index: true },
    actorId: { type: mongoose.Schema.Types.ObjectId, default: null },
    source: { type: String, default: 'api' },
    reason: { type: String, default: '' },
    baseRevisionId: { type: mongoose.Schema.Types.ObjectId, default: null },
    expectedLockVersion: { type: Number, required: true },
    status: {
      type: String,
      enum: ['PUBLISHED', 'REVIEW REQUIRED', 'VALIDATION FAILED', 'REJECTED', 'CANCELLED'],
      required: true,
    },
    proposedLines: { type: [lineSchema], default: [] },
  },
  { timestamps: true }
);

const pinSchema = new mongoose.Schema(
  {
    scopeId: { type: String, required: true, index: true },
    revisionId: { type: mongoose.Schema.Types.ObjectId, required: true },
    kind: { type: String, enum: ['release', 'amendment'], required: true },
    quantity: { type: Number, required: true, min: 0 },
    completedQuantity: { type: Number, default: 0, min: 0 },
    parentPinId: { type: mongoose.Schema.Types.ObjectId, default: null },
    note: { type: String, default: '' },
    actorId: { type: mongoose.Schema.Types.ObjectId, default: null },
  },
  { timestamps: true }
);

scopeStateSchema.plugin(toJSON);
scopeStateSchema.plugin(paginate);
revisionSchema.plugin(toJSON);
revisionSchema.plugin(paginate);
checkpointSchema.plugin(toJSON);
changeRequestSchema.plugin(toJSON);
changeRequestSchema.plugin(paginate);
pinSchema.plugin(toJSON);

const VersionScope = mongoose.model('VersionScope', scopeStateSchema);
const VersionRevision = mongoose.model('VersionRevision', revisionSchema);
const VersionCheckpoint = mongoose.model('VersionCheckpoint', checkpointSchema);
const VersionChangeRequest = mongoose.model('VersionChangeRequest', changeRequestSchema);
const VersionPin = mongoose.model('VersionPin', pinSchema);

export { VersionScope, VersionRevision, VersionCheckpoint, VersionChangeRequest, VersionPin };
