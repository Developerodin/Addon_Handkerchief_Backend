import httpStatus from 'http-status';
import ApiError from '../../utils/ApiError.js';
import { PieceBundle, ThreadUse } from '../../models/production.model.js';
import { activeMachine, boardFor, bundleCodes, loadBundles, logBundles, rackOfType } from './bundleFloor.js';

/**
 * Bundles of one process on a rack, and the same process already on a machine.
 * @param {object} waitingQuery
 * @param {string} doneProcess
 */
export const stationBoard = (waitingQuery, doneProcess) =>
  boardFor(
    { ...waitingQuery, rackCode: { $nin: ['', null] } },
    { ...waitingQuery, rackCode: { $in: ['', null] }, machineBarcode: { $nin: ['', null] } },
    { process: doneProcess },
    { process: doneProcess, rackCode: { $nin: ['', null] } }
  );

/**
 * Typed thread quantity. Zero is allowed.
 * @param {unknown} value
 */
export const threadQuantity = (value) => {
  if (value == null || value === '') throw new ApiError(httpStatus.BAD_REQUEST, 'Thread quantity is required');
  const quantity = Number(value);
  if (Number.isNaN(quantity) || quantity < 0) throw new ApiError(httpStatus.BAD_REQUEST, 'Thread quantity is required');
  return quantity;
};

/**
 * Moves racked bundles onto a machine without changing process.
 * @param {object} args
 */
export const startOnMachine = async ({ body, user, accept, action, missingMachine }) => {
  const codes = bundleCodes(body.bundleBarcodes);
  const rackCode = String(body.rackCode || '').trim();
  const machineBarcode = String(body.machineBarcode || '').trim();
  if (!codes.length) throw new ApiError(httpStatus.BAD_REQUEST, 'Bundle barcodes are required');
  if (!rackCode) throw new ApiError(httpStatus.BAD_REQUEST, 'Rack is required');
  if (!machineBarcode) throw new ApiError(httpStatus.BAD_REQUEST, 'Machine barcode is required');
  const machine = await activeMachine(machineBarcode, missingMachine);
  const rack = await rackOfType(rackCode, 'bundles', 'This rack is not for bundles');
  const bundles = await loadBundles(codes);
  for (const bundle of bundles) accept(bundle, rack.code);
  await PieceBundle.updateMany({ barcode: { $in: codes } }, { rackCode: '', machineBarcode: machine.barcode });
  await logBundles(bundles, { action, fromLocation: rack.code, toLocation: machine.barcode, remarks: '' }, user);
  return PieceBundle.find({ barcode: { $in: codes } });
};

/**
 * Puts station bundles on a bundles rack and optionally writes thread.
 * @param {object} args
 */
export const placeOnRack = async ({ body, user, accept, nextProcess, action, threadRole }) => {
  const codes = bundleCodes(body.bundleBarcodes);
  const rackCode = String(body.rackCode || '').trim();
  if (!codes.length) throw new ApiError(httpStatus.BAD_REQUEST, 'Bundle barcodes are required');
  if (!rackCode) throw new ApiError(httpStatus.BAD_REQUEST, 'Rack is required');
  const used = threadRole ? threadQuantity(body.threadQuantity) : 0;
  const rack = await rackOfType(rackCode, 'bundles', 'This rack is not for bundles');
  const bundles = await loadBundles(codes);
  for (const bundle of bundles) accept(bundle);
  if (threadRole) {
    const orderIds = [...new Set(bundles.map((bundle) => String(bundle.orderId)))];
    await ThreadUse.create(
      orderIds.map((orderId) => ({
        orderId,
        machineBarcode: bundles.find((bundle) => String(bundle.orderId) === orderId)?.machineBarcode || '',
        materialRole: threadRole,
        quantity: used,
      }))
    );
  }
  await PieceBundle.updateMany({ barcode: { $in: codes } }, { process: nextProcess, rackCode: rack.code });
  await logBundles(bundles, { action, fromLocation: '', toLocation: rack.code, remarks: threadRole ? String(used) : '' }, user);
  return PieceBundle.find({ barcode: { $in: codes } });
};
