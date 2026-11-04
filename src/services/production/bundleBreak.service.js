import httpStatus from 'http-status';
import ApiError from '../../utils/ApiError.js';
import { PieceBundle, ProductionOrder } from '../../models/production.model.js';
import { boardFor, bundleCodes, loadBundles, logBundles } from './bundleFloor.js';

/**
 * Ironed bundles on a rack, ready to be broken.
 */
export const upcomingBundleBreak = async () =>
  boardFor(
    { closed: true, process: 'ironed', rackCode: { $nin: ['', null] } },
    { process: 'none' },
    { process: 'broken' },
    { process: 'broken', rackCode: { $nin: ['', null] } }
  );

/**
 * Counts the pieces. The count must match final QC, and the order picks the route.
 * @param {{ bundleBarcodes?: string[], pieceCount?: number }} body
 * @param {object} [_params]
 * @param {object | null} [user]
 */
export const breakForRoute = async (body, _params, user) => {
  const codes = bundleCodes(body.bundleBarcodes);
  const count = Number(body.pieceCount);
  if (!codes.length) throw new ApiError(httpStatus.BAD_REQUEST, 'Bundle barcodes are required');
  if (!Number.isInteger(count) || count < 1) throw new ApiError(httpStatus.BAD_REQUEST, 'Piece count is required');
  const bundles = await loadBundles(codes);
  const orders = await ProductionOrder.find({ _id: { $in: bundles.map((bundle) => bundle.orderId) } }).select('productionType');
  const types = new Map(orders.map((order) => [String(order.id), order.productionType]));
  for (const bundle of bundles) {
    if (bundle.process === 'broken') throw new ApiError(httpStatus.BAD_REQUEST, 'This bundle is already broken');
    if (bundle.process !== 'ironed' || !bundle.rackCode) throw new ApiError(httpStatus.BAD_REQUEST, 'This bundle is not ironed on a rack');
    if (count !== bundle.finalGood) throw new ApiError(httpStatus.BAD_REQUEST, 'Piece count must match the good count');
    const route = types.get(String(bundle.orderId));
    if (!['normal', 'embroidery', 'sticker'].includes(route)) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'This order has no route');
    }
  }
  for (const bundle of bundles) {
    bundle.process = 'broken';
    bundle.route = types.get(String(bundle.orderId));
    await bundle.save();
  }
  await logBundles(bundles, { action: 'bundle-break', fromLocation: bundles[0].rackCode, toLocation: bundles[0].route, remarks: String(count) }, user);
  return PieceBundle.find({ barcode: { $in: codes } });
};
