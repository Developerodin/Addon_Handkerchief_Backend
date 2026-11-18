import httpStatus from 'http-status';
import ApiError from '../../utils/ApiError.js';
import { PieceBundle } from '../../models/production.model.js';
import { activeMachine, boardFor, bundleCodes, loadBundles, logBundles, rackOfType } from './bundleFloor.js';
import { runTransaction, sessionOptions } from '../../utils/mongoTransaction.js';
import { applyRouteBreak } from './bundleBreak.service.js';

const waitingAfterQc = {
  closed: true,
  process: 'final-qc',
  finalGood: { $gt: 0 },
  rackCode: { $nin: ['', null] },
};

const onIron = {
  process: 'final-qc',
  rackCode: { $in: ['', null] },
  machineBarcode: { $nin: ['', null] },
};

/**
 * Good bundles on a rack after final QC, and bundles already on an iron.
 */
export const upcomingIron = async () =>
  boardFor(
    waitingAfterQc,
    onIron,
    { process: { $in: ['ironed', 'broken'] } },
    { process: { $in: ['ironed', 'broken'] }, rackCode: { $nin: ['', null] } },
    ['iron-done', 'bundle-break', 'iron-start']
  );

/**
 * Assigns container bundles to an iron. The container is cleared.
 * @param {{ bundleBarcodes?: string[], machineBarcode?: string }} body
 * @param {object} [_params]
 * @param {object | null} [user]
 */
export const startIron = async (body, _params, user) => {
  const codes = bundleCodes(body.bundleBarcodes);
  const rackCode = String(body.rackCode || '').trim();
  const machineBarcode = String(body.machineBarcode || '').trim();
  if (!codes.length) throw new ApiError(httpStatus.BAD_REQUEST, 'Bundle barcodes are required');
  if (!rackCode) throw new ApiError(httpStatus.BAD_REQUEST, 'Rack is required');
  if (!machineBarcode) throw new ApiError(httpStatus.BAD_REQUEST, 'Iron barcode is required');
  const rack = await rackOfType(rackCode, 'bundles', 'This rack is not for bundles');
  const machine = await activeMachine(machineBarcode, 'Iron not found');
  const bundles = await loadBundles(codes);
  for (const bundle of bundles) {
    if (bundle.process === 'ironed' || bundle.process === 'iron-after') {
      throw new ApiError(httpStatus.BAD_REQUEST, 'This bundle is already ironed');
    }
    if (bundle.process !== 'final-qc' || !(bundle.finalGood > 0) || !bundle.rackCode) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'This bundle is not waiting for ironing after final QC');
    }
    if (bundle.rackCode !== rack.code) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'This bundle is not on that rack');
    }
  }
  return runTransaction(async (session) => {
    await PieceBundle.updateMany(
      { barcode: { $in: codes } },
      { rackCode: '', machineBarcode: machine.barcode, containerBarcode: '' },
      sessionOptions(session)
    );
    await logBundles(
      bundles,
      { action: 'iron-start', fromLocation: rack.code, toLocation: machine.barcode, remarks: '' },
      user,
      session
    );
    return PieceBundle.find({ barcode: { $in: codes } }).session(session || undefined);
  });
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
    if (bundle.process !== 'final-qc' || bundle.rackCode || !bundle.machineBarcode) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'This bundle is not on the iron');
    }
  }
  return runTransaction(async (session) => {
    await PieceBundle.updateMany(
      { barcode: { $in: codes } },
      { rackCode: rack.code, machineBarcode: '', containerBarcode: '' },
      sessionOptions(session)
    );
    await logBundles(bundles, { action: 'iron-done', fromLocation: '', toLocation: rack.code, remarks: '' }, user, session);
    const placed = await PieceBundle.find({ barcode: { $in: codes } }).session(session || undefined);
    await applyRouteBreak(placed, user, session);
    return PieceBundle.find({ barcode: { $in: codes } }).session(session || undefined);
  });
};
