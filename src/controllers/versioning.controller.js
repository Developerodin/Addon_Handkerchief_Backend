import httpStatus from 'http-status';
import catchAsync from '../utils/catchAsync.js';
import { VersionRevision, VersionScope } from '../models/versioning.model.js';
import { createCheckpoint, readReadyCheckpoint, reconstructState } from '../services/versioning/checkpoint.service.js';
import { createPin, getPin } from '../services/versioning/pin.service.js';
import { listReviewRequests, publishScope, revertScope } from '../services/versioning/publish.service.js';

/**
 * Publishes the proposed lines for a scope.
 */
export const publish = catchAsync(async (req, res) => {
  const result = await publishScope({
    scopeId: req.params.scopeId,
    expectedLockVersion: req.body.expectedLockVersion,
    baseRevisionId: req.body.baseRevisionId || null,
    lines: req.body.lines,
    reason: req.body.reason,
    requireReview: req.body.requireReview,
    dependencyPins: req.body.dependencyPins,
    actorId: req.user.id,
    source: 'api',
  });
  const status = result.published ? httpStatus.CREATED : httpStatus.OK;
  res.status(status).send(result);
});

/**
 * Restores older content as a new revision.
 */
export const revert = catchAsync(async (req, res) => {
  const result = await revertScope({
    scopeId: req.params.scopeId,
    expectedLockVersion: req.body.expectedLockVersion,
    sourceRevisionId: req.body.sourceRevisionId,
    reason: req.body.reason,
    actorId: req.user.id,
  });
  const status = result.published ? httpStatus.CREATED : httpStatus.OK;
  res.status(status).send(result);
});

/**
 * Returns the current effective state and lock.
 */
export const getScope = catchAsync(async (req, res) => {
  const scope = await VersionScope.findOne({ scopeId: req.params.scopeId });
  if (!scope) {
    res.status(httpStatus.NOT_FOUND).send({ message: 'Scope not found' });
    return;
  }
  res.send(scope);
});

/**
 * Lists published revisions for one style and route. Sequence is display order.
 */
export const listRevisions = catchAsync(async (req, res) => {
  const results = await VersionRevision.find({ scopeId: req.params.scopeId }).sort({ sequence: 1 });
  res.send({ results });
});

/**
 * Rebuilds state at a historical revision.
 */
export const reconstruct = catchAsync(async (req, res) => {
  const state = await reconstructState(req.params.scopeId, req.params.revisionId);
  res.send(state);
});

/**
 * Writes a READY checkpoint for a revision.
 */
export const checkpoint = catchAsync(async (req, res) => {
  const saved = await createCheckpoint(req.params.scopeId, req.body.revisionId);
  res.status(httpStatus.CREATED).send(saved);
});

/**
 * Reads a checkpoint. FAILED and BUILDING are refused.
 */
export const getCheckpoint = catchAsync(async (req, res) => {
  const saved = await readReadyCheckpoint(req.params.checkpointId);
  res.send(saved);
});

/**
 * Lists REVIEW REQUIRED change requests. This is not a merge screen.
 */
export const reviews = catchAsync(async (req, res) => {
  const results = await listReviewRequests();
  res.send({ results });
});

/**
 * Pins a release or an amendment segment to a revision.
 */
export const pin = catchAsync(async (req, res) => {
  const saved = await createPin({ ...req.body, actorId: req.user.id });
  res.status(httpStatus.CREATED).send(saved);
});

/**
 * Loads a pin and, for an amendment, the unchanged parent.
 */
export const readPin = catchAsync(async (req, res) => {
  const saved = await getPin(req.params.pinId);
  res.send(saved);
});
