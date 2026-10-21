import httpStatus from 'http-status';
import ApiError from '../../utils/ApiError.js';
import { VersionPin, VersionRevision } from '../../models/versioning.model.js';

/**
 * Pins a scope to an exact revision. An amendment does not change the parent pin.
 * @param {object} input
 * @returns {Promise<object>}
 */
export const createPin = async (input) => {
  const revision = await VersionRevision.findOne({ _id: input.revisionId, scopeId: input.scopeId });
  if (!revision) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Revision not found');
  }
  if (input.quantity < 0 || (input.completedQuantity || 0) < 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'VALIDATION FAILED: quantity cannot be negative');
  }

  let parent = null;
  if (input.kind === 'amendment') {
    if (!input.parentPinId) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'VALIDATION FAILED: amendment needs a parent pin');
    }
    parent = await VersionPin.findById(input.parentPinId);
    if (!parent || parent.scopeId !== input.scopeId) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Parent pin not found');
    }
  }

  const pin = await VersionPin.create({
    scopeId: input.scopeId,
    revisionId: input.revisionId,
    kind: input.kind,
    quantity: input.quantity,
    completedQuantity: input.completedQuantity || 0,
    parentPinId: parent ? parent._id : null,
    note: input.note || '',
    actorId: input.actorId || null,
  });

  return { pin, parentRevisionId: parent ? parent.revisionId : null };
};

/**
 * Loads a pin and its parent without rewriting either revision.
 * @param {string} pinId
 * @returns {Promise<{ pin: object, parent: object | null }>}
 */
export const getPin = async (pinId) => {
  const pin = await VersionPin.findById(pinId);
  if (!pin) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Pin not found');
  }
  const parent = pin.parentPinId ? await VersionPin.findById(pin.parentPinId) : null;
  return { pin, parent };
};
