import mongoose from 'mongoose';
import httpStatus from 'http-status';
import ApiError from '../../utils/ApiError.js';
import { VersionChangeRequest, VersionRevision, VersionScope } from '../../models/versioning.model.js';
import { applyDeltas, CANONICALIZATION_VERSION, diffLines, sortLines, validateLines } from './diff.service.js';
import { hashValue } from './hash.service.js';
import { reconstructState } from './checkpoint.service.js';

const SCHEMA_VERSION = 1;

/**
 * Runs the callback in one Mongo transaction. A thrown error rolls the writes back.
 * @param {(session: import('mongoose').ClientSession) => Promise<unknown>} work
 * @returns {Promise<unknown>}
 */
const runTransaction = async (work) => {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await work(session);
    });
    return result;
  } finally {
    session.endSession();
  }
};

/**
 * Publishes a line set for one scope, or records a review hold without changing effective state.
 * @param {object} input
 * @returns {Promise<object>}
 */
export const publishScope = async (input) => {
  const check = validateLines(input.lines);
  if (!check.ok) {
    throw new ApiError(httpStatus.BAD_REQUEST, check.message);
  }
  const proposed = sortLines(input.lines);

  if (input.requireReview) {
    const changeRequest = await VersionChangeRequest.create({
      scopeId: input.scopeId,
      actorId: input.actorId || null,
      source: input.source || 'api',
      reason: input.reason || '',
      baseRevisionId: input.baseRevisionId || null,
      expectedLockVersion: input.expectedLockVersion,
      status: 'REVIEW REQUIRED',
      proposedLines: proposed,
    });
    return { published: false, status: 'REVIEW REQUIRED', changeRequest, revision: null };
  }

  try {
    return await runTransaction((session) => commitPublish(session, input, proposed));
  } catch (error) {
    if (error?.code === 11000) {
      throw new ApiError(httpStatus.CONFLICT, 'Stale lock');
    }
    throw error;
  }
};

/**
 * Writes one revision and the new effective pointer, or returns unchanged.
 * @param {import('mongoose').ClientSession} session
 * @param {object} input
 * @param {object[]} proposed
 * @returns {Promise<object>}
 */
const commitPublish = async (session, input, proposed) => {
  const scope = await VersionScope.findOne({ scopeId: input.scopeId }).session(session);
  const lock = scope ? scope.lockVersion : 0;
  if (lock !== input.expectedLockVersion) {
    throw new ApiError(httpStatus.CONFLICT, 'Stale lock');
  }
  const effectiveId = scope?.effectiveRevisionId ? String(scope.effectiveRevisionId) : '';
  if (input.baseRevisionId && effectiveId !== String(input.baseRevisionId)) {
    throw new ApiError(httpStatus.CONFLICT, 'Stale base revision');
  }

  const currentLines = scope?.effectiveState?.lines || [];
  const diff = diffLines(currentLines, proposed);
  if (diff.empty) {
    return { published: false, status: 'UNCHANGED', revision: null, scope };
  }

  const nextLines = applyDeltas(currentLines, diff.deltas);
  const sequence = (scope?.sequence || 0) + 1;
  const [revision] = await VersionRevision.create(
    [
      {
        scopeId: input.scopeId,
        sequence,
        baseRevisionId: scope?.effectiveRevisionId || null,
        deltas: diff.deltas,
        schemaVersion: SCHEMA_VERSION,
        canonicalizationVersion: CANONICALIZATION_VERSION,
        dependencyPins: input.dependencyPins || [],
        changeSetHash: hashValue(diff.deltas),
        resultStateHash: hashValue(nextLines),
        reason: input.reason || '',
        actorId: input.actorId || null,
      },
    ],
    { session }
  );

  let nextScope = scope;
  if (!scope) {
    const created = await VersionScope.create(
      [
        {
          scopeId: input.scopeId,
          effectiveRevisionId: revision._id,
          lockVersion: 1,
          sequence,
          effectiveState: { lines: nextLines },
        },
      ],
      { session }
    );
    nextScope = created[0];
  } else {
    const updated = await VersionScope.findOneAndUpdate(
      { _id: scope._id, lockVersion: input.expectedLockVersion },
      {
        $set: {
          effectiveRevisionId: revision._id,
          sequence,
          effectiveState: { lines: nextLines },
        },
        $inc: { lockVersion: 1 },
      },
      { new: true, session }
    );
    if (!updated) {
      throw new ApiError(httpStatus.CONFLICT, 'Stale lock');
    }
    nextScope = updated;
  }

  await VersionChangeRequest.create(
    [
      {
        scopeId: input.scopeId,
        actorId: input.actorId || null,
        source: input.source || 'api',
        reason: input.reason || '',
        baseRevisionId: revision.baseRevisionId,
        expectedLockVersion: input.expectedLockVersion,
        status: 'PUBLISHED',
        proposedLines: proposed,
      },
    ],
    { session }
  );

  return { published: true, status: 'PUBLISHED', revision, scope: nextScope };
};

/**
 * Publishes the next revision whose content matches an older revision. Does not repoint history.
 * @param {object} input
 * @returns {Promise<object>}
 */
export const revertScope = async (input) => {
  const state = await reconstructState(input.scopeId, input.sourceRevisionId);
  return publishScope({
    scopeId: input.scopeId,
    expectedLockVersion: input.expectedLockVersion,
    lines: state.lines,
    reason: input.reason || `Restore content of ${input.sourceRevisionId}`,
    actorId: input.actorId,
    source: 'revert',
  });
};

/**
 * Lists change requests waiting for a person to resolve them.
 * @returns {Promise<object[]>}
 */
export const listReviewRequests = () =>
  VersionChangeRequest.find({ status: 'REVIEW REQUIRED' }).sort({ createdAt: -1 });
