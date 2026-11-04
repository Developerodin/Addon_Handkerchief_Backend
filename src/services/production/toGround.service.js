import httpStatus from 'http-status';
import ApiError from '../../utils/ApiError.js';
import { PieceBundle } from '../../models/production.model.js';
import { boardFor, bundleCodes, bundleContainer, loadBundles, logBundles } from './bundleFloor.js';

const waiting = { closed: true, process: 'final-qc', finalGood: { $gt: 0 }, rackCode: { $nin: ['', null] } };

/**
 * Good bundles still on a rack, ready for a ground-floor container.
 */
export const upcomingToGround = async () =>
  boardFor(waiting, { process: 'in-container' }, { process: 'in-container' }, { process: 'in-container', containerBarcode: { $nin: ['', null] } });

/**
 * Maps final-QC bundles into one bundle container and clears their rack.
 * @param {{ bundleBarcodes?: string[], containerBarcode?: string }} body
 * @param {object} [_params]
 * @param {object | null} [user]
 */
export const placeToGround = async (body, _params, user) => {
  const codes = bundleCodes(body.bundleBarcodes);
  const scanned = String(body.containerBarcode || '').trim();
  if (!codes.length) throw new ApiError(httpStatus.BAD_REQUEST, 'Bundle barcodes are required');
  if (!scanned) throw new ApiError(httpStatus.BAD_REQUEST, 'Container is required');
  const container = await bundleContainer(scanned);
  const bundles = await loadBundles(codes);
  for (const bundle of bundles) {
    if (bundle.process === 'in-container') throw new ApiError(httpStatus.BAD_REQUEST, 'This bundle is already in a container');
    if (bundle.process !== 'final-qc' || !(bundle.finalGood > 0) || !bundle.rackCode) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'This bundle is not ready for the ground floor');
    }
  }
  await PieceBundle.updateMany({ barcode: { $in: codes } }, { process: 'in-container', containerBarcode: container.barcode || container.code, rackCode: '' });
  await logBundles(bundles, { action: 'to-ground', fromLocation: bundles[0].rackCode, toLocation: container.code, remarks: '' }, user);
  return PieceBundle.find({ barcode: { $in: codes } });
};
