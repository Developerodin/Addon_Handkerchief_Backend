import httpStatus from 'http-status';
import ApiError from '../../utils/ApiError.js';
import { PieceBundle, ProductionOrder } from '../../models/production.model.js';
import { QualityResult } from '../../models/quality.model.js';
import { ClientOrder, DispatchBox, PackingBundle } from '../../models/warehouse.model.js';
import { StockMovement } from '../../models/store.model.js';
import Product from '../../models/product.model.js';
import StyleCode from '../../models/styleCode.model.js';
import ProductionRack from '../../models/productionRack.model.js';
import { nextCode } from '../factory/ids.js';
import { orderMap, rackOfType, shapeBundle } from '../production/bundleFloor.js';
import { writeOrderLog } from '../orderLog.service.js';

/**
 * Whole count, or zero when the field is blank.
 * @param {unknown} value
 */
const whole = (value) => {
  const count = value == null || value === '' ? 0 : Number(value);
  if (!Number.isInteger(count) || count < 0) return null;
  return count;
};

/**
 * Standard pieces per packing bundle from the item's style (60–120). Null when not configured.
 * @param {string} orderId
 */
const packingSize = async (orderId) => {
  const order = await ProductionOrder.findById(orderId);
  if (!order?.itemId) throw new ApiError(httpStatus.BAD_REQUEST, 'This order has no catalog item');
  const product = await Product.findById(order.itemId).select('styleCodes name');
  let style = null;
  if (product?.styleCodes?.length) {
    style = await StyleCode.findById(product.styleCodes[0]);
  }
  if (!style) {
    style = await StyleCode.findOne({ linkedItem: order.itemId, status: 'active' });
  }
  const raw = Number(style?.packingBundleQty) || 0;
  const size = raw >= 60 && raw <= 120 ? raw : null;
  return { order, size, itemName: product?.name || '' };
};

/**
 * @param {number | null} size
 * @param {number} remaining
 * @param {number} count
 */
const assertPackCount = (size, remaining, count) => {
  if (count > remaining) throw new ApiError(httpStatus.BAD_REQUEST, 'This count is more than what is left');
  if (size) {
    const leftover = remaining < size && count === remaining;
    if (count !== size && !leftover) {
      throw new ApiError(httpStatus.BAD_REQUEST, `Piece count must be ${size}, or ${remaining} for the last pack`);
    }
    return;
  }
  if (count !== remaining) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'This item has no packing bundle qty on its style code — pack all remaining pieces in one bundle, or set Packing Bundle Qty (60–120) on the style'
    );
  }
};

/**
 * Closed bundle on a packing rack with a final-checking result and pieces left.
 * @param {string} barcode
 */
const readyToPack = async (barcode) => {
  const bundle = await PieceBundle.findOne({ barcode: String(barcode || '').trim() });
  if (!bundle || !bundle.closed || !bundle.rackCode) throw new ApiError(httpStatus.BAD_REQUEST, 'This bundle is not ready for packing');
  const result = await QualityResult.findOne({ kind: 'final-checking', bundleId: String(bundle.id) });
  if (!result) throw new ApiError(httpStatus.BAD_REQUEST, 'This bundle is not ready for packing');
  const rack = await ProductionRack.findOne({ status: 'active', code: String(bundle.rackCode).toUpperCase() });
  if (!rack || rack.stockType !== 'packing') throw new ApiError(httpStatus.BAD_REQUEST, 'This bundle is not ready for packing');
  return bundle;
};

/**
 * Piece bundles that still have final-checking good quantity, plus packing bundles not yet in a box.
 */
export const upcomingPacking = async () => {
  const racks = await ProductionRack.find({ status: 'active', stockType: 'packing' }).select('code');
  const rows = await PieceBundle.find({
    closed: true,
    rackCode: { $in: racks.map((rack) => rack.code) },
    finalGood: { $gt: 0 },
  })
    .sort({ updatedAt: -1 })
    .limit(200);
  const checked = await QualityResult.find({
    kind: 'final-checking',
    bundleId: { $in: rows.map((row) => String(row.id)) },
  }).select('bundleId');
  const allowed = new Set(checked.map((row) => String(row.bundleId)));
  const waiting = rows.filter((row) => allowed.has(String(row.id)) && row.finalGood - (row.packedQty || 0) > 0);
  const loose = await PackingBundle.find({ boxBarcode: '' }).sort({ createdAt: -1 }).limit(200);
  const openBoxes = await DispatchBox.find({ status: 'open' }).sort({ updatedAt: -1 }).limit(100);
  const readyForDispatch = await DispatchBox.find({ status: { $in: ['ready-for-dispatch', 'on-rack'] } })
    .sort({ updatedAt: -1 })
    .limit(100);
  const orders = await orderMap([...waiting, ...loose.map((row) => ({ orderId: row.orderId }))]);
  const sizes = new Map();
  await Promise.all(
    [...new Set(waiting.map((row) => String(row.orderId)))].map(async (orderId) => {
      try {
        sizes.set(orderId, (await packingSize(orderId)).size || 0);
      } catch (err) {
        if (!(err instanceof ApiError)) throw err;
        sizes.set(orderId, 0);
      }
    })
  );
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const boxedToday = await DispatchBox.countDocuments({ createdAt: { $gte: start } });
  const boxOrderMap = await boxOrderNumberMap([...openBoxes, ...readyForDispatch]);
  const waitingRows = waiting.map((row) => ({ ...shapeBundle(row, orders), packingSize: sizes.get(String(row.orderId)) || 0 }));
  const looseRows = loose.map((row) => ({
      id: String(row.id),
      barcode: row.barcode,
      qty: row.qty,
      scaleWeight: Number(row.scaleWeight) || 0,
      orderId: String(row.orderId || ''),
      orderNumber: orders.get(String(row.orderId))?.orderNumber || '',
      pieceBundleBarcode: row.pieceBundleBarcode || '',
    }));
  const openBoxRows = openBoxes.map((row) => withBoxOrderNumber(shapeOpenBox, row, boxOrderMap));
  const readyRows = readyForDispatch.map((row) => withBoxOrderNumber(shapeDispatchBox, row, boxOrderMap));
  const byOrderMap = new Map();
  const orderSlot = (orderId, orderNumber) => {
    const key = orderId || orderNumber || '—';
    let slot = byOrderMap.get(key);
    if (!slot) {
      slot = {
        orderId: orderId || '',
        orderNumber: orderNumber || '—',
        waitingBundles: 0,
        looseBundles: 0,
        openBoxes: 0,
        piecesWaiting: 0,
        piecesPacked: 0,
        piecesInOpenBoxes: 0,
      };
      byOrderMap.set(key, slot);
    }
    return slot;
  };
  for (const row of waitingRows) {
    const slot = orderSlot(String(row.orderId || ''), row.orderNumber || '');
    slot.waitingBundles += 1;
    slot.piecesWaiting += row.finalGood - (row.packedQty || 0);
  }
  for (const row of looseRows) {
    const slot = orderSlot(row.orderId, row.orderNumber);
    slot.looseBundles += 1;
    slot.piecesPacked += row.qty;
  }
  for (const row of openBoxRows) {
    const slot = orderSlot(row.productionOrderId, row.orderNumber);
    slot.openBoxes += 1;
    slot.piecesInOpenBoxes += row.pieceQty;
  }
  return {
    results: waitingRows,
    loose: looseRows,
    openBoxes: openBoxRows,
    readyForDispatch: readyRows,
    byOrder: [...byOrderMap.values()].sort((a, b) => a.orderNumber.localeCompare(b.orderNumber)),
    counts: {
      waiting: waiting.length,
      onStation: loose.length,
      doneToday: boxedToday,
      onRack: readyForDispatch.filter((row) => row.status === 'on-rack').length,
      openBoxes: openBoxes.length,
    },
  };
};

/**
 * Cuts one packing bundle off the final-checking remainder and gives it a barcode.
 * @param {object} body
 * @param {object} [_params]
 * @param {object | null} [user]
 */
export const packPieces = async (body, _params, user) => {
  const count = whole(body.pieceCount);
  if (count == null) throw new ApiError(httpStatus.BAD_REQUEST, 'Piece count is invalid');
  if (count < 1) throw new ApiError(httpStatus.BAD_REQUEST, 'Piece count is required');
  const weight = body.scaleWeight == null || body.scaleWeight === '' ? NaN : Number(body.scaleWeight);
  if (!Number.isFinite(weight) || weight <= 0) throw new ApiError(httpStatus.BAD_REQUEST, 'Scale weight is required');
  const bundle = await readyToPack(body.bundleBarcode);
  const remaining = bundle.finalGood - (bundle.packedQty || 0);
  if (remaining < 1) throw new ApiError(httpStatus.BAD_REQUEST, 'This bundle is not ready for packing');
  const { order, size } = await packingSize(bundle.orderId);
  assertPackCount(size, remaining, count);
  const row = await PackingBundle.create({
    barcode: nextCode('PB'),
    orderId: bundle.orderId,
    qty: count,
    scaleWeight: weight,
    pieceBundleBarcode: bundle.barcode,
    revisionId: order.revisionId || '',
    onPackingRack: true,
  });
  bundle.packedQty = (bundle.packedQty || 0) + count;
  await bundle.save();
  await writeOrderLog(
    {
      action: 'packing',
      orderId: bundle.orderId,
      entityType: 'bundle',
      entityCode: row.barcode,
      quantity: count,
      fromLocation: bundle.rackCode,
    },
    user
  );
  return row;
};

/**
 * Distinct scanned packing-bundle barcodes.
 * @param {string[] | undefined} barcodes
 */
const packCodes = (barcodes) => [...new Set((barcodes || []).map((code) => String(code || '').trim()).filter(Boolean))];

/**
 * Puts unpacked packing bundles into one box. The box is not weighed here.
 * @param {object} body
 * @param {object} [_params]
 * @param {object | null} [user]
 */
export const sealBox = async (body, _params, user) => {
  const codes = packCodes(body.packingBundleBarcodes);
  if (!codes.length) throw new ApiError(httpStatus.BAD_REQUEST, 'Packing bundle barcode is required');
  const bundles = await PackingBundle.find({ barcode: { $in: codes } });
  if (bundles.length !== codes.length) throw new ApiError(httpStatus.BAD_REQUEST, 'Every packing bundle must already exist');
  if (bundles.some((row) => row.boxBarcode)) throw new ApiError(httpStatus.BAD_REQUEST, 'This packing bundle is already in a box');
  if (bundles.some((row) => (Number(row.scaleWeight) || 0) <= 0)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Every packing bundle must be weighed before it goes in a box');
  }
  const orderIds = new Set(bundles.map((row) => String(row.orderId)));
  if (orderIds.size !== 1) throw new ApiError(httpStatus.BAD_REQUEST, 'Packing bundles must be from one order');
  const pieceQty = bundles.reduce((sum, row) => sum + row.qty, 0);
  const box = await DispatchBox.create({
    barcode: nextCode('BOX'),
    clientOrderId: body.clientOrderId || undefined,
    productionOrderId: bundles[0].orderId,
    revisionId: bundles[0].revisionId || '',
    packingBundleIds: bundles.map((row) => row.barcode),
    pieceQty,
    scaleWeight: 0,
    status: 'open',
  });
  await PackingBundle.updateMany({ barcode: { $in: codes } }, { boxBarcode: box.barcode, onPackingRack: false });
  await writeOrderLog(
    {
      action: 'box-pack',
      orderId: bundles[0].orderId,
      entityType: 'box',
      entityCode: box.barcode,
      quantity: pieceQty,
    },
    user
  );
  return box;
};

/**
 * @param {object} row
 */
const shapeOpenBox = (row) => ({
  id: String(row.id || row._id),
  barcode: row.barcode,
  productionOrderId: row.productionOrderId ? String(row.productionOrderId) : '',
  orderNumber: row.orderNumber || '',
  pieceQty: row.pieceQty || 0,
  bundleCount: (row.packingBundleIds || []).length,
  scaleWeight: Number(row.scaleWeight) || 0,
  packingBundleIds: row.packingBundleIds || [],
});

const shapeDispatchBox = (row) => ({
  id: String(row.id || row._id),
  barcode: row.barcode,
  status: row.status,
  productionOrderId: row.productionOrderId ? String(row.productionOrderId) : '',
  orderNumber: row.orderNumber || '',
  pieceQty: row.pieceQty || 0,
  bundleCount: (row.packingBundleIds || []).length,
  scaleWeight: Number(row.scaleWeight) || 0,
  rackCode: row.rackCode || '',
  packingBundleIds: row.packingBundleIds || [],
  vehicleNumber: row.vehicleNumber || '',
});

/**
 * @param {Array<{ productionOrderId?: unknown; orderNumber?: string }>} rows
 */
const boxOrderNumberMap = async (rows) => {
  const ids = [...new Set(rows.map((row) => String(row.productionOrderId || '')).filter((id) => id && id !== 'undefined'))];
  if (!ids.length) return new Map();
  const orders = await ProductionOrder.find({ _id: { $in: ids } }).select('orderNumber');
  return new Map(orders.map((order) => [String(order._id), order.orderNumber || '']));
};

const withBoxOrderNumber = (shape, row, map) => ({
  ...shape(row),
  orderNumber: row.orderNumber || map.get(String(row.productionOrderId)) || '',
});

/**
 * Resolve one open box by barcode (scan station).
 * @param {object} query
 */
export const lookupOpenBox = async (query) => {
  const barcode = String(query.barcode || '').trim();
  if (!barcode) throw new ApiError(httpStatus.BAD_REQUEST, 'Box barcode is required');
  const box = await DispatchBox.findOne({ barcode, status: 'open' });
  if (!box) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'This box is not open — create a new box or pick one that is still open.');
  }
  return shapeOpenBox(box);
};

/**
 * Empty dispatch box barcode for scan-to-pack workflow.
 * @param {object} [_body]
 * @param {object} [_params]
 * @param {object | null} [user]
 */
export const openBox = async (_body, _params, user) => {
  const box = await DispatchBox.create({
    barcode: nextCode('BOX'),
    packingBundleIds: [],
    pieceQty: 0,
    scaleWeight: 0,
    status: 'open',
  });
  await writeOrderLog(
    {
      action: 'box-open',
      entityType: 'box',
      entityCode: box.barcode,
      quantity: 0,
    },
    user
  );
  return box;
};

/**
 * Scans one weighed packing bundle into an open box.
 * @param {object} body
 * @param {object} [_params]
 * @param {object | null} [user]
 */
export const addBundleToBox = async (body, _params, user) => {
  const boxBarcode = String(body.boxBarcode || '').trim();
  const packBarcode = String(body.packingBundleBarcode || '').trim();
  if (!boxBarcode || !packBarcode) throw new ApiError(httpStatus.BAD_REQUEST, 'Box and packing bundle barcodes are required');
  const box = await DispatchBox.findOne({ barcode: boxBarcode });
  if (!box) throw new ApiError(httpStatus.BAD_REQUEST, 'Box not found');
  if (box.status !== 'open') throw new ApiError(httpStatus.BAD_REQUEST, 'This box is not open');
  const bundle = await PackingBundle.findOne({ barcode: packBarcode });
  if (!bundle) throw new ApiError(httpStatus.BAD_REQUEST, 'Packing bundle not found');
  if (bundle.boxBarcode) throw new ApiError(httpStatus.BAD_REQUEST, 'This packing bundle is already in a box');
  if ((Number(bundle.scaleWeight) || 0) <= 0) throw new ApiError(httpStatus.BAD_REQUEST, 'Weigh the packing bundle before it goes in a box');
  if (box.productionOrderId && String(box.productionOrderId) !== String(bundle.orderId)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Packing bundles in one box must be from one order');
  }
  if ((box.packingBundleIds || []).length) {
    const orderIds = new Set(
      (await PackingBundle.find({ barcode: { $in: box.packingBundleIds } }).select('orderId')).map((row) => String(row.orderId))
    );
    orderIds.add(String(bundle.orderId));
    if (orderIds.size > 1) throw new ApiError(httpStatus.BAD_REQUEST, 'Packing bundles in one box must be from one order');
  }
  if (!box.productionOrderId) {
    box.productionOrderId = bundle.orderId;
    box.revisionId = bundle.revisionId || '';
  }
  if (!box.orderNumber) {
    const po = await ProductionOrder.findById(bundle.orderId).select('orderNumber');
    box.orderNumber = po?.orderNumber || '';
  }
  const ids = [...new Set([...(box.packingBundleIds || []), bundle.barcode])];
  box.packingBundleIds = ids;
  box.pieceQty = (box.pieceQty || 0) + bundle.qty;
  bundle.boxBarcode = box.barcode;
  bundle.onPackingRack = false;
  await Promise.all([box.save(), bundle.save()]);
  await writeOrderLog(
    {
      action: 'box-add-bundle',
      orderId: bundle.orderId,
      entityType: 'box',
      entityCode: box.barcode,
      quantity: bundle.qty,
      remarks: packBarcode,
    },
    user
  );
  return { box: shapeOpenBox(box), bundle };
};

export const upcomingBoxes = async () => {
  const [open, weighed, ready, onRack] = await Promise.all([
    DispatchBox.find({ status: 'open' }).sort({ updatedAt: -1 }).limit(200),
    DispatchBox.find({ status: 'weighed' }).sort({ updatedAt: -1 }).limit(200),
    DispatchBox.find({ status: 'ready-for-dispatch' }).sort({ updatedAt: -1 }).limit(200),
    DispatchBox.find({ status: 'on-rack' }).sort({ updatedAt: -1 }).limit(100),
  ]);
  const orderMap = await boxOrderNumberMap([...open, ...weighed, ...ready, ...onRack]);
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const storedToday = await DispatchBox.countDocuments({ status: 'on-rack', updatedAt: { $gte: start } });
  const toWeigh = open.filter((row) => (row.packingBundleIds || []).length > 0);
  return {
    results: toWeigh.map((row) => withBoxOrderNumber(shapeDispatchBox, row, orderMap)),
    active: weighed.map((row) => withBoxOrderNumber(shapeDispatchBox, row, orderMap)),
    readyForDispatch: ready.map((row) => withBoxOrderNumber(shapeDispatchBox, row, orderMap)),
    onRack: onRack.map((row) => withBoxOrderNumber(shapeDispatchBox, row, orderMap)),
    counts: {
      waiting: toWeigh.length,
      onStation: weighed.length,
      ready: ready.length,
      doneToday: storedToday,
      onRack: onRack.length,
    },
  };
};

/**
 * Stores the typed scale weight. Zero and a blank are refused.
 * @param {object} body
 */
export const weighBox = async (body) => {
  const box = await DispatchBox.findOne({ barcode: String(body.boxBarcode || '').trim() });
  if (!box) throw new ApiError(httpStatus.BAD_REQUEST, 'Box not found');
  if (box.status === 'weighed') throw new ApiError(httpStatus.BAD_REQUEST, 'This box is already weighed');
  if (box.status !== 'open') throw new ApiError(httpStatus.BAD_REQUEST, 'This box is not open');
  if (!(box.packingBundleIds || []).length) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Add packing bundles to the box before weighing');
  }
  const weight = body.scaleWeight == null || body.scaleWeight === '' ? NaN : Number(body.scaleWeight);
  if (!Number.isFinite(weight) || weight <= 0) throw new ApiError(httpStatus.BAD_REQUEST, 'Scale weight is required');
  box.scaleWeight = weight;
  box.status = 'weighed';
  await box.save();
  return shapeDispatchBox(box);
};

/**
 * Weighed box is sealed and may print the dispatch label before it goes on a rack.
 * @param {object} body
 * @param {object} [_params]
 * @param {object | null} [user]
 */
export const markBoxReady = async (body, _params, user) => {
  const box = await DispatchBox.findOne({ barcode: String(body.boxBarcode || '').trim() });
  if (!box) throw new ApiError(httpStatus.BAD_REQUEST, 'Box not found');
  if (box.status === 'ready-for-dispatch') return shapeDispatchBox(box);
  if (box.status !== 'weighed') throw new ApiError(httpStatus.BAD_REQUEST, 'Weigh the box before marking it ready');
  box.status = 'ready-for-dispatch';
  await box.save();
  await writeOrderLog(
    {
      action: 'box-ready',
      orderId: box.productionOrderId,
      entityType: 'box',
      entityCode: box.barcode,
      quantity: box.pieceQty,
      remarks: `${box.scaleWeight} kg`,
    },
    user
  );
  return shapeDispatchBox(box);
};

/**
 * Puts a weighed box on a box rack. A bundles rack or a packing rack is refused.
 * @param {object} body
 * @param {object} [_params]
 * @param {object | null} [user]
 */
export const storeBox = async (body, _params, user) => {
  const box = await DispatchBox.findOne({ barcode: String(body.boxBarcode || '').trim() });
  if (!box) throw new ApiError(httpStatus.BAD_REQUEST, 'Box not found');
  if (box.status === 'on-rack') throw new ApiError(httpStatus.BAD_REQUEST, 'This box is already on a rack');
  if (box.status !== 'ready-for-dispatch') {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Mark the box ready for dispatch before putting it on a rack');
  }
  const rack = await rackOfType(body.rackCode, 'box', 'This rack is not for boxes');
  box.rackCode = rack.code;
  box.status = 'on-rack';
  await box.save();
  await StockMovement.create({
    entityType: 'box',
    entityId: box.barcode,
    kind: 'rack',
    toLocation: rack.code,
    quantity: 1,
    orderId: box.productionOrderId,
  });
  await writeOrderLog(
    {
      action: 'box-rack',
      orderId: box.productionOrderId,
      entityType: 'box',
      entityCode: box.barcode,
      toLocation: rack.code,
    },
    user
  );
  return box;
};

/**
 * Boxes sitting on a rack.
 */
export const upcomingDispatch = async () => {
  const rows = await DispatchBox.find({ status: 'on-rack' }).sort({ updatedAt: -1 }).limit(200);
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const doneToday = await DispatchBox.countDocuments({ status: 'dispatched', updatedAt: { $gte: start } });
  const shaped = rows.map(shapeDispatchBox);
  const orderIds = [...new Set(shaped.map((row) => row.productionOrderId).filter(Boolean))];
  const orders = orderIds.length
    ? await ProductionOrder.find({ _id: { $in: orderIds } }).select('orderNumber targetQty dispatchedQty dispatchStatus buyer')
    : [];
  const orderMap = new Map(orders.map((row) => [String(row.id), row]));
  const byOrder = [];
  for (const id of orderIds) {
    const meta = orderMap.get(id);
    const boxes = shaped.filter((row) => row.productionOrderId === id);
    byOrder.push({
      orderId: id,
      orderNumber: meta?.orderNumber || boxes[0]?.orderNumber || '',
      buyer: meta?.buyer || '',
      targetQty: meta?.targetQty || 0,
      dispatchedQty: meta?.dispatchedQty || 0,
      dispatchStatus: meta?.dispatchStatus || 'none',
      boxes,
    });
  }
  const loose = shaped.filter((row) => !row.productionOrderId);
  if (loose.length) {
    byOrder.push({
      orderId: '',
      orderNumber: '—',
      buyer: '',
      targetQty: 0,
      dispatchedQty: 0,
      dispatchStatus: 'none',
      boxes: loose,
    });
  }
  return {
    results: shaped,
    byOrder,
    counts: { waiting: rows.length, onStation: 0, doneToday, onRack: rows.length },
  };
};

/**
 * Scans one on-rack box out. The same event does not ship it twice.
 * @param {object} body
 * @param {object} [_params]
 * @param {object | null} [user]
 */
export const shipBox = async () => {
  throw new ApiError(
    httpStatus.GONE,
    'Single-box dispatch is retired. Create a dispatch batch, scan boxes, and dispatch the batch.'
  );
};
