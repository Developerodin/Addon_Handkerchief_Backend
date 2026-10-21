import httpStatus from 'http-status';
import ApiError from '../../utils/ApiError.js';
import { hashValue } from '../versioning/hash.service.js';
import { SyncCursor, SyncInbox, SyncOutbox } from '../../models/sync.model.js';

const RETRY_LIMIT = 5;

/**
 * Writes one outbox row. Pass a session to join the business transaction.
 * @param {object} event
 * @param {import('mongoose').ClientSession} [session]
 */
export const enqueueEvent = async (event, session) => {
  const payloadHash = hashValue(event.payload);
  const doc = {
    eventId: event.eventId,
    siteId: event.siteId || 'factory',
    entityType: event.entityType,
    aggregateId: String(event.aggregateId),
    aggregateVersion: event.aggregateVersion || 1,
    operation: event.operation,
    payload: event.payload,
    payloadHash,
    dependsOn: event.dependsOn || [],
    status: 'PENDING',
    schemaVersion: event.schemaVersion || 1,
  };
  const created = await SyncOutbox.create([doc], session ? { session } : undefined);
  return created[0];
};

/**
 * Applies one event once. A repeated eventId returns the original inbox row.
 * A different payload for that id is rejected. A missing dependency waits.
 * @param {object} event
 * @param {(event: object) => Promise<void>} [applyBusiness]
 */
export const applyEvent = async (event, applyBusiness) => {
  const payloadHash = hashValue(event.payload ?? {});
  const existing = await SyncInbox.findOne({ eventId: event.eventId });
  if (existing) {
    if (existing.payloadHash !== payloadHash) {
      throw new ApiError(httpStatus.CONFLICT, 'Same eventId, different payload');
    }
    if (existing.status === 'ACKNOWLEDGED' || existing.status === 'QUARANTINED') return existing;
    await existing.deleteOne();
  }

  const dependsOn = event.dependsOn || [];
  for (const dep of dependsOn) {
    const ready = await SyncInbox.findOne({ eventId: dep, status: 'ACKNOWLEDGED' });
    if (!ready) {
      return SyncInbox.create({
        eventId: event.eventId,
        sourceSiteId: event.siteId || 'cloud',
        payloadHash,
        entityType: event.entityType,
        aggregateId: String(event.aggregateId),
        status: 'WAITING_DEPENDENCY',
      });
    }
  }

  const outbox = await SyncOutbox.findOne({ eventId: event.eventId });
  const attempts = (outbox?.attempts || 0) + 1;
  try {
    if (applyBusiness) await applyBusiness(event);
    if (outbox) {
      outbox.status = 'ACKNOWLEDGED';
      outbox.attempts = attempts;
      await outbox.save();
    }
    const inbox = await SyncInbox.create({
      eventId: event.eventId,
      sourceSiteId: event.siteId || 'factory',
      payloadHash,
      entityType: event.entityType,
      aggregateId: String(event.aggregateId),
      status: 'ACKNOWLEDGED',
      attempts,
    });
    await SyncCursor.findOneAndUpdate(
      { siteId: event.siteId || 'factory' },
      { $set: { lastSuccessAt: new Date() }, $inc: { lastSequence: 1 } },
      { upsert: true }
    );
    return inbox;
  } catch (error) {
    const status = attempts >= RETRY_LIMIT ? 'QUARANTINED' : 'RETRYING';
    if (outbox) {
      outbox.status = status;
      outbox.attempts = attempts;
      outbox.lastError = error.message || 'apply failed';
      await outbox.save();
    }
    return SyncInbox.create({
      eventId: event.eventId,
      sourceSiteId: event.siteId || 'factory',
      payloadHash,
      entityType: event.entityType,
      aggregateId: String(event.aggregateId),
      status,
      attempts,
      lastError: error.message || 'apply failed',
    });
  }
};

/**
 * Connection board for the Sync screen. Reports are not included.
 */
export const syncStatus = async () => {
  const [pending, quarantined, waiting, failed, cursor] = await Promise.all([
    SyncOutbox.countDocuments({ status: { $in: ['PENDING', 'RETRYING', 'PROCESSING'] } }),
    SyncOutbox.countDocuments({ status: 'QUARANTINED' }),
    SyncInbox.countDocuments({ status: 'WAITING_DEPENDENCY' }),
    SyncInbox.countDocuments({ status: { $in: ['REJECTED', 'CONFLICTED'] } }),
    SyncCursor.findOne({ siteId: 'factory' }),
  ]);
  const oldest = await SyncOutbox.findOne({ status: { $in: ['PENDING', 'RETRYING'] } }).sort({ createdAt: 1 });
  return {
    connected: true,
    pending,
    quarantined,
    waitingDependency: waiting,
    failed,
    cursor: cursor?.lastSequence || 0,
    lastSuccessAt: cursor?.lastSuccessAt || null,
    oldestUnsyncedAt: oldest?.createdAt || null,
    schemaVersion: 1,
  };
};

/**
 * Events after a cursor, ordered inside each aggregate by creation time.
 * @param {{ afterSequence?: number, limit?: number }} query
 */
export const pullEvents = async (query) => {
  const limit = Math.min(query.limit || 100, 500);
  const rows = await SyncOutbox.find({ status: { $in: ['PENDING', 'RETRYING', 'ACKNOWLEDGED'] } })
    .sort({ createdAt: 1 })
    .skip(query.afterSequence || 0)
    .limit(limit);
  return rows;
};
