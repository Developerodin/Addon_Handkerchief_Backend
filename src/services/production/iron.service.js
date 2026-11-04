import httpStatus from 'http-status';
import ApiError from '../../utils/ApiError.js';
import { PieceBundle } from '../../models/production.model.js';
import { activeMachine, boardFor, bundleCodes, loadBundles, logBundles, rackOfType } from './bundleFloor.js';

const onIron = { process: 'in-container', containerBarcode: { $in: ['', null] }, machineBarcode: { $nin: ['', null] } };

/**
 * Bundles in a container, and bundles already on an iron.
 */
export const upcomingIron = async () =>
  boardFor(
    { closed: true, process: 'in-container', containerBarcode: { $nin: ['', null] } },
    onIron,
    { process: 'ironed' },
    { process: 'ironed', rackCode: { $nin: ['', null] } }
  );

/**
 * Assigns container bundles to an iron. The container is cleared.
 * @param {{ bundleBarcodes?: string[], machineBarcode?: string }} body
 * @param {object} [_params]
 * @param {object | null} [user]
 */
export const startIron = async (body, _params, user) => {
  const codes = bundleCodes(body.bundleBarcodes);
  const machineBarcode = String(body.machineBarcode || '').trim();
  if (!codes.length) throw new ApiError(httpStatus.BAD_REQUEST, 'Bundle barcodes are required');
  if (!machineBarcode) throw new ApiError(httpStatus.BAD_REQUEST, 'Iron barcode is required');
  const machine = await activeMachine(machineBarcode, 'Iron not found');
  const bundles = await loadBundles(codes);
  for (const bundle of bundles) {
    if (bundle.process === 'ironed' || bundle.process === 'iron-after') {
      throw new ApiError(httpStatus.BAD_REQUEST, 'This bundle is already ironed');
    }
    if (bundle.process !== 'in-container' || !bundle.containerBarcode) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'This bundle is not in a container');
    }
  }
  await PieceBundle.updateMany({ barcode: { $in: codes } }, { containerBarcode: '', machineBarcode: machine.barcode });
  await logBundles(bundles, { action: 'iron-start', fromLocation: bundles[0].containerBarcode, toLocation: machine.barcode, remarks: '' }, user);
  return PieceBundle.find({ barcode: { $in: codes } });
};

/**
 * Puts ironed bundles on a bundles rack. Quantity and the good count stay.
 * @param {{ bundleBarcodes?: string[], rackCode?: string }} body
 * @param {object} [_params]
 * @param {object | null} [user]
 */
export const placeIron = async (body, _params, user) => {
  const codes = bundleCodes(body.bundleBarcodes);
  const rackCode = String(body.rackCode || '').trim();
  if (!codes.length) throw new ApiError(httpStatus.BAD_REQUEST, 'Bundle barcodes are required');
  if (!rackCode) throw new ApiError(httpStatus.BAD_REQUEST, 'Rack is required');
  const rack = await rackOfType(rackCode, 'bundles', 'This rack is not for bundles');
  const bundles = await loadBundles(codes);
  for (const bundle of bundles) {
    if (bundle.process === 'ironed') throw new ApiError(httpStatus.BAD_REQUEST, 'This bundle is already ironed');
    if (bundle.process !== 'in-container' || bundle.containerBarcode || !bundle.machineBarcode) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'This bundle is not on the iron');
    }
  }
  await PieceBundle.updateMany({ barcode: { $in: codes } }, { process: 'ironed', rackCode: rack.code });
  await logBundles(bundles, { action: 'iron-done', fromLocation: '', toLocation: rack.code, remarks: '' }, user);
  return PieceBundle.find({ barcode: { $in: codes } });
};
