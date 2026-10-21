import httpStatus from 'http-status';
import ApiError from '../../utils/ApiError.js';
import { VersionCheckpoint, VersionRevision } from '../../models/versioning.model.js';
import { applyDeltas } from './diff.service.js';
import { hashValue } from './hash.service.js';

/**
 * Rebuilds line state at a revision from the nearest READY checkpoint and later deltas.
 * FAILED checkpoints are ignored.
 * @param {string} scopeId
 * @param {string} revisionId
 * @returns {Promise<{ lines: object[], revision: object }>}
 */
export const reconstructState = async (scopeId, revisionId) => {
  const target = await VersionRevision.findOne({ _id: revisionId, scopeId });
  if (!target) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Revision not found');
  }

  const checkpoint = await VersionCheckpoint.findOne({
    scopeId,
    status: 'READY',
    sequence: { $lte: target.sequence },
  }).sort({ sequence: -1 });

  let lines = checkpoint?.state?.lines || [];
  const fromSequence = checkpoint ? checkpoint.sequence : 0;
  const revisions = await VersionRevision.find({
    scopeId,
    sequence: { $gt: fromSequence, $lte: target.sequence },
  }).sort({ sequence: 1 });

  for (const revision of revisions) {
    lines = applyDeltas(lines, revision.deltas);
  }

  return { lines, revision: target };
};

/**
 * Stores a full READY snapshot at a revision. A failure is marked FAILED and is not readable.
 * @param {string} scopeId
 * @param {string} revisionId
 * @returns {Promise<object>}
 */
export const createCheckpoint = async (scopeId, revisionId) => {
  const revision = await VersionRevision.findOne({ _id: revisionId, scopeId });
  if (!revision) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Revision not found');
  }

  const checkpoint = await VersionCheckpoint.create({
    scopeId,
    revisionId,
    sequence: revision.sequence,
    state: { lines: [] },
    checksum: 'building',
    formatVersion: 1,
    status: 'BUILDING',
  });

  try {
    const state = await reconstructState(scopeId, revisionId);
    checkpoint.status = 'READY';
    checkpoint.state = { lines: state.lines };
    checkpoint.checksum = hashValue(state.lines);
    await checkpoint.save();
    return checkpoint;
  } catch (error) {
    checkpoint.status = 'FAILED';
    checkpoint.checksum = 'failed';
    await checkpoint.save();
    throw error;
  }
};

/**
 * Returns a checkpoint only when it is READY.
 * @param {string} checkpointId
 * @returns {Promise<object>}
 */
export const readReadyCheckpoint = async (checkpointId) => {
  const checkpoint = await VersionCheckpoint.findById(checkpointId);
  if (!checkpoint || checkpoint.status !== 'READY') {
    throw new ApiError(httpStatus.CONFLICT, 'Checkpoint is not readable');
  }
  return checkpoint;
};
