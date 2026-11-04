import httpStatus from 'http-status';
import ApiError from '../../utils/ApiError.js';
import { PieceBundle } from '../../models/production.model.js';
import { activeMachine, boardFor, bundleCodes, loadBundles, logBundles, rackOfType } from './bundleFloor.js';

const ready = { process: { $in: ['embroidery-thread-cut', 'sticker'] } };

/**
 * Embroidery thread-cut bundles and sticker bundles waiting for the second iron.
 */
export const upcomingIronAfter = async () =>
  boardFor(
    { ...ready, closed: true, rackCode: { $nin: ['', null] } },
    { ...ready, rackCode: { $in: ['', null] }, machineBarcode: { $nin: ['', null] } },
    { process: 'iron-after' },
    { process: 'iron-after', rackCode: { $nin: ['', null] } }
  );

/**
 * @param {object} body
 * @param {object} [_params]
 * @param {object | null} [user]
 */
export const startIronAfter = async (body, _params, user) => {
  const codes = bundleCodes(body.bundleBarcodes);
  const rackCode = String(body.rackCode || '').trim();
  const machineBarcode = String(body.machineBarcode || '').trim();
  if (!codes.length) throw new ApiError(httpStatus.BAD_REQUEST, 'Bundle barcodes are required');
  if (!rackCode) throw new ApiError(httpStatus.BAD_REQUEST, 'Rack is required');
  if (!machineBarcode) throw new ApiError(httpStatus.BAD_REQUEST, 'Iron barcode is required');
  const machine = await activeMachine(machineBarcode, 'Iron not found');
  const rack = await rackOfType(rackCode, 'bundles', 'This rack is not for bundles');
  const bundles = await loadBundles(codes);
  for (const bundle of bundles) {
    if (bundle.process === 'iron-after') throw new ApiError(httpStatus.BAD_REQUEST, 'This bundle is already ironed');
    if (!['embroidery-thread-cut', 'sticker'].includes(bundle.process)) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'This bundle is not ready for the second iron');
    }
    if (bundle.rackCode !== rack.code) throw new ApiError(httpStatus.BAD_REQUEST, 'This bundle is not on that rack');
  }
  await PieceBundle.updateMany({ barcode: { $in: codes } }, { rackCode: '', machineBarcode: machine.barcode });
  await logBundles(bundles, { action: 'iron-after-start', fromLocation: rack.code, toLocation: machine.barcode, remarks: '' }, user);
  return PieceBundle.find({ barcode: { $in: codes } });
};

/**
 * @param {object} body
 * @param {object} [_params]
 * @param {object | null} [user]
 */
export const placeIronAfter = async (body, _params, user) => {
  const codes = bundleCodes(body.bundleBarcodes);
  const rackCode = String(body.rackCode || '').trim();
  if (!codes.length) throw new ApiError(httpStatus.BAD_REQUEST, 'Bundle barcodes are required');
  if (!rackCode) throw new ApiError(httpStatus.BAD_REQUEST, 'Rack is required');
  const rack = await rackOfType(rackCode, 'bundles', 'This rack is not for bundles');
  const bundles = await loadBundles(codes);
  for (const bundle of bundles) {
    if (bundle.process === 'iron-after') throw new ApiError(httpStatus.BAD_REQUEST, 'This bundle is already ironed');
    if (!['embroidery-thread-cut', 'sticker'].includes(bundle.process) || bundle.rackCode || !bundle.machineBarcode) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'This bundle is not on the iron');
    }
  }
  await PieceBundle.updateMany({ barcode: { $in: codes } }, { process: 'iron-after', rackCode: rack.code });
  await logBundles(bundles, { action: 'iron-after-done', fromLocation: '', toLocation: rack.code, remarks: '' }, user);
  return PieceBundle.find({ barcode: { $in: codes } });
};
