import mongoose from 'mongoose';
import { toJSON } from './plugins/index.js';

const SYNC_STATUSES = [
  'PENDING',
  'PROCESSING',
  'ACKNOWLEDGED',
  'RETRYING',
  'WAITING_DEPENDENCY',
  'CONFLICTED',
  'QUARANTINED',
  'REJECTED',
  'SUPERSEDED',
];

const outboxSchema = mongoose.Schema(
  {
    eventId: { type: String, required: true, unique: true },
    siteId: { type: String, required: true, default: 'factory' },
    entityType: { type: String, required: true },
    aggregateId: { type: String, required: true },
    aggregateVersion: { type: Number, default: 1 },
    operation: { type: String, required: true },
    payload: { type: mongoose.Schema.Types.Mixed, required: true },
    payloadHash: { type: String, required: true },
    dependsOn: [{ type: String }],
    status: { type: String, enum: SYNC_STATUSES, default: 'PENDING' },
    attempts: { type: Number, default: 0 },
    schemaVersion: { type: Number, default: 1 },
    lastError: { type: String, default: '' },
  },
  { timestamps: true }
);

const inboxSchema = mongoose.Schema(
  {
    eventId: { type: String, required: true, unique: true },
    sourceSiteId: { type: String, default: 'factory' },
    payloadHash: { type: String, required: true },
    entityType: { type: String, required: true },
    aggregateId: { type: String, required: true },
    status: { type: String, enum: SYNC_STATUSES, default: 'ACKNOWLEDGED' },
    attempts: { type: Number, default: 0 },
    lastError: { type: String, default: '' },
  },
  { timestamps: true }
);

const cursorSchema = mongoose.Schema(
  {
    siteId: { type: String, required: true, unique: true },
    lastSequence: { type: Number, default: 0 },
    lastSuccessAt: { type: Date, default: null },
  },
  { timestamps: true }
);

outboxSchema.plugin(toJSON);
inboxSchema.plugin(toJSON);
cursorSchema.plugin(toJSON);

export const SyncOutbox = mongoose.model('SyncOutbox', outboxSchema);
export const SyncInbox = mongoose.model('SyncInbox', inboxSchema);
export const SyncCursor = mongoose.model('SyncCursor', cursorSchema);
export { SYNC_STATUSES };
