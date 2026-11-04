import httpStatus from 'http-status';
import ApiError from '../../utils/ApiError.js';
import { placeOnRack, startOnMachine, stationBoard } from './stationFloor.js';

const waiting = { closed: true, process: 'broken', route: 'sticker' };

/**
 * Broken sticker bundles on a rack.
 */
export const upcomingSticker = () => stationBoard(waiting, 'sticker');

/**
 * @param {object} bundle
 * @param {string} rackCode
 */
const acceptStart = (bundle, rackCode) => {
  if (bundle.process === 'sticker') throw new ApiError(httpStatus.BAD_REQUEST, 'This bundle is already stickered');
  if (bundle.route !== 'sticker' || bundle.process !== 'broken') throw new ApiError(httpStatus.BAD_REQUEST, 'This bundle is not for sticker');
  if (!bundle.rackCode || bundle.rackCode !== rackCode) throw new ApiError(httpStatus.BAD_REQUEST, 'This bundle is not on that rack');
};

/**
 * @param {object} body
 * @param {object} [_params]
 * @param {object | null} [user]
 */
export const startSticker = (body, _params, user) =>
  startOnMachine({ body, user, accept: acceptStart, action: 'sticker-start', missingMachine: 'Table not found' });

/**
 * @param {object} bundle
 */
const acceptPlace = (bundle) => {
  if (bundle.process === 'sticker') throw new ApiError(httpStatus.BAD_REQUEST, 'This bundle is already stickered');
  if (bundle.route !== 'sticker' || bundle.process !== 'broken' || bundle.rackCode || !bundle.machineBarcode) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'This bundle is not on the table');
  }
};

/**
 * Puts sticker bundles back on a rack. No thread is written.
 * @param {object} body
 * @param {object} [_params]
 * @param {object | null} [user]
 */
export const placeSticker = (body, _params, user) =>
  placeOnRack({ body, user, accept: acceptPlace, nextProcess: 'sticker', action: 'sticker-done' });
