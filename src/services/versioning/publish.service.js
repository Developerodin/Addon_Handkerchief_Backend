import mongoose from 'mongoose';
import httpStatus from 'http-status';
import ApiError from '../../utils/ApiError.js';
import { VersionChangeRequest, VersionRevision, VersionScope } from '../../models/versioning.model.js';
import { applyDeltas, CANONICALIZATION_VERSION, diffLines, sortLines, validateLines } from './diff.service.js';
import { hashValue } from './hash.service.js';
import { reconstructState } from './checkpoint.service.js';

const SCHEMA_VERSION = 1;

const isTransactionUnsupported = (error) => {
  const message = String(error?.message || '');
  return (
    error?.code === 20 ||
    message.includes('Transaction numbers are only allowed') ||
    (message.includes('transaction') && message.includes('replica set')) ||
    (message.includes('not support') && message.includes('transaction'))
  );
};

/**
 * Runs the callback in one Mongo transaction when the server supports it.
 * Falls back to a non-transactional write on standalone MongoDB.
 * @param {(session: import('mongoose').ClientSession|null) => Promise<unknown>} work
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
  } catch (error) {
    if (isTransactionUnsupported(error)) {
      console.warn('publishScope: transactions unavailable, falling back to non-transactional publish');
      return work(null);
    }
    throw error;
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
 * @param {import('mongoose').ClientSession|null} session
 * @param {object} input
 * @param {object[]} proposed
 * @returns {Promise<object>}
 */
const commitPublish = async (session, input, proposed) => {
  const scopeQuery = VersionScope.findOne({ scopeId: input.scopeId });
  if (session) scopeQuery.session(session);
  const scope = await scopeQuery;
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
  const revisionDoc = {
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
  };
  const revision = session
    ? (await VersionRevision.create([revisionDoc], { session }))[0]
    : await VersionRevision.create(revisionDoc);

  let nextScope = scope;
  if (!scope) {
    const scopeDoc = {
      scopeId: input.scopeId,
      effectiveRevisionId: revision._id,
      lockVersion: 1,
      sequence,
      effectiveState: { lines: nextLines },
    };
    nextScope = session
      ? (await VersionScope.create([scopeDoc], { session }))[0]
      : await VersionScope.create(scopeDoc);
  } else {
    const updateQuery = VersionScope.findOneAndUpdate(
      { _id: scope._id, lockVersion: input.expectedLockVersion },
      {
        $set: {
          effectiveRevisionId: revision._id,
          sequence,
          effectiveState: { lines: nextLines },
        },
        $inc: { lockVersion: 1 },
      },
      { new: true }
    );
    if (session) updateQuery.session(session);
    const updated = await updateQuery;
    if (!updated) {
      throw new ApiError(httpStatus.CONFLICT, 'Stale lock');
    }
    nextScope = updated;
  }

  const changeRequestDoc = {
    scopeId: input.scopeId,
    actorId: input.actorId || null,
    source: input.source || 'api',
    reason: input.reason || '',
    baseRevisionId: revision.baseRevisionId,
    expectedLockVersion: input.expectedLockVersion,
    status: 'PUBLISHED',
    proposedLines: proposed,
  };
  if (session) {
    await VersionChangeRequest.create([changeRequestDoc], { session });
  } else {
    await VersionChangeRequest.create(changeRequestDoc);
  }

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
