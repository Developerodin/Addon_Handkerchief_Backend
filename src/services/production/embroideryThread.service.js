import httpStatus from 'http-status';
import ApiError from '../../utils/ApiError.js';
import { placeOnRack, startOnMachine, stationBoard } from './stationFloor.js';

const waiting = { closed: true, process: 'embroidery' };

/**
 * Embroidered bundles on a rack, waiting for thread cutting.
 */
export const upcomingEmbroideryThread = () => stationBoard(waiting, 'embroidery-thread-cut');

/**
 * @param {object} bundle
 * @param {string} rackCode
 */
const acceptStart = (bundle, rackCode) => {
  if (bundle.process === 'embroidery-thread-cut') throw new ApiError(httpStatus.BAD_REQUEST, 'This bundle is already thread cut');
  if (bundle.process !== 'embroidery') throw new ApiError(httpStatus.BAD_REQUEST, 'This bundle is not embroidered');
  if (!bundle.rackCode || bundle.rackCode !== rackCode) throw new ApiError(httpStatus.BAD_REQUEST, 'This bundle is not on that rack');
};

/**
 * @param {object} body
 * @param {object} [_params]
 * @param {object | null} [user]
 */
export const startEmbroideryThread = (body, _params, user) =>
  startOnMachine({ body, user, accept: acceptStart, action: 'embroidery-thread-start', missingMachine: 'Table not found' });

/**
 * @param {object} bundle
 */
const acceptPlace = (bundle) => {
  if (bundle.process === 'embroidery-thread-cut') throw new ApiError(httpStatus.BAD_REQUEST, 'This bundle is already thread cut');
  if (bundle.process !== 'embroidery' || bundle.rackCode || !bundle.machineBarcode) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'This bundle is not on the table');
  }
};

/**
 * Puts thread-cut embroidery bundles on a rack. No thread row is written.
 * @param {object} body
 * @param {object} [_params]
 * @param {object | null} [user]
 */
export const placeEmbroideryThread = (body, _params, user) =>
  placeOnRack({ body, user, accept: acceptPlace, nextProcess: 'embroidery-thread-cut', action: 'embroidery-thread-done' });
