import httpStatus from 'http-status';
import ApiError from '../../utils/ApiError.js';
import { placeOnRack, startOnMachine, stationBoard } from './stationFloor.js';

const waiting = { closed: true, process: 'broken', route: 'embroidery' };

/**
 * Broken embroidery bundles on a rack.
 */
export const upcomingEmbroidery = () => stationBoard(waiting, 'embroidery');

/**
 * @param {object} bundle
 * @param {string} rackCode
 */
const acceptStart = (bundle, rackCode) => {
  if (bundle.process === 'embroidery') throw new ApiError(httpStatus.BAD_REQUEST, 'This bundle is already embroidered');
  if (bundle.route !== 'embroidery' || bundle.process !== 'broken') {
    throw new ApiError(httpStatus.BAD_REQUEST, 'This bundle is not for embroidery');
  }
  if (!bundle.rackCode || bundle.rackCode !== rackCode) throw new ApiError(httpStatus.BAD_REQUEST, 'This bundle is not on that rack');
};

/**
 * @param {{ bundleBarcodes?: string[], rackCode?: string, machineBarcode?: string }} body
 * @param {object} [_params]
 * @param {object | null} [user]
 */
export const startEmbroidery = (body, _params, user) =>
  startOnMachine({ body, user, accept: acceptStart, action: 'embroidery-start', missingMachine: 'Machine not found' });

/**
 * @param {object} bundle
 */
const acceptPlace = (bundle) => {
  if (bundle.process === 'embroidery') throw new ApiError(httpStatus.BAD_REQUEST, 'This bundle is already embroidered');
  if (bundle.route !== 'embroidery' || bundle.process !== 'broken' || bundle.rackCode || !bundle.machineBarcode) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'This bundle is not on the machine');
  }
};

/**
 * @param {{ bundleBarcodes?: string[], rackCode?: string, threadQuantity?: number }} body
 * @param {object} [_params]
 * @param {object | null} [user]
 */
export const placeEmbroidery = (body, _params, user) =>
  placeOnRack({
    body,
    user,
    accept: acceptPlace,
    nextProcess: 'embroidery',
    action: 'embroidery-done',
    threadRole: 'embroidery-thread',
  });
