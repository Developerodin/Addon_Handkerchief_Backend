import { ProductionOrder } from '../../models/production.model.js';
import { DispatchBox } from '../../models/warehouse.model.js';
import { writeOrderLog } from '../orderLog.service.js';

/**
 * Roll up dispatched piece qty onto the production order.
 * @param {string} orderId
 * @param {object | null} [user]
 */
export const syncProductionOrderDispatch = async (orderId, user) => {
  if (!orderId) return null;
  const order = await ProductionOrder.findById(orderId);
  if (!order) return null;
  const rows = await DispatchBox.find({ productionOrderId: orderId, status: 'dispatched' }).select('pieceQty');
  const dispatchedQty = rows.reduce((sum, row) => sum + (Number(row.pieceQty) || 0), 0);
  const target = Number(order.targetQty) || 0;
  order.dispatchedQty = dispatchedQty;
  if (dispatchedQty <= 0) order.dispatchStatus = 'none';
  else if (target > 0 && dispatchedQty >= target) order.dispatchStatus = 'complete';
  else order.dispatchStatus = 'partial';
  await order.save();
  if (order.dispatchStatus === 'complete') {
    await writeOrderLog(
      {
        action: 'order-dispatch-complete',
        orderId: order.id,
        entityType: 'order',
        entityCode: order.orderNumber || String(order.id),
        quantity: dispatchedQty,
      },
      user
    );
  }
  return {
    orderNumber: order.orderNumber,
    targetQty: target,
    dispatchedQty,
    dispatchStatus: order.dispatchStatus,
  };
};

/**
 * Production orders that have boxes on the dispatch floor or in the pipeline.
 */
export const dispatchOrdersSummary = async (query = {}) => {
  const rows = await DispatchBox.find({
    status: { $in: ['open', 'weighed', 'ready-for-dispatch', 'on-rack', 'dispatched'] },
    productionOrderId: { $exists: true, $ne: null },
  }).select('productionOrderId status pieceQty orderNumber');
  const byId = new Map();
  for (const row of rows) {
    const id = String(row.productionOrderId);
    const slot = byId.get(id) || { onRack: 0, pipeline: 0, dispatchedPieces: 0, boxCount: 0 };
    slot.boxCount += 1;
    if (row.status === 'on-rack') slot.onRack += 1;
    else if (row.status === 'dispatched') slot.dispatchedPieces += Number(row.pieceQty) || 0;
    else slot.pipeline += 1;
    byId.set(id, slot);
  }
  const orders = await ProductionOrder.find({ _id: { $in: [...byId.keys()] } }).select(
    'orderNumber buyer targetQty dispatchedQty dispatchStatus'
  );
  const results = orders.map((order) => ({
    orderId: String(order.id),
    orderNumber: order.orderNumber || '',
    buyer: order.buyer || '',
    targetQty: order.targetQty || 0,
    dispatchedQty: order.dispatchedQty || 0,
    dispatchStatus: order.dispatchStatus || 'none',
    ...(byId.get(String(order.id)) || { onRack: 0, pipeline: 0, dispatchedPieces: 0, boxCount: 0 }),
  }));
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 50));
  const skip = (page - 1) * limit;
  const totalResults = results.length;
  return {
    results: results.slice(skip, skip + limit),
    page,
    limit,
    totalResults,
    totalPages: Math.max(1, Math.ceil(totalResults / limit)),
  };
};

const shapeDispatchBox = (row, orderNumber = '') => ({
  id: String(row._id || row.id),
  barcode: row.barcode,
  status: row.status,
  productionOrderId: row.productionOrderId ? String(row.productionOrderId) : '',
  orderNumber: row.orderNumber || orderNumber,
  pieceQty: row.pieceQty || 0,
  bundleCount: (row.packingBundleIds || []).length,
  scaleWeight: Number(row.scaleWeight) || 0,
  rackCode: row.rackCode || '',
  vehicleNumber: row.vehicleNumber || '',
  packingBundleIds: row.packingBundleIds || [],
  updatedAt: row.updatedAt,
});

export const dispatchPackForOrder = async (orderId) => {
  const order = await ProductionOrder.findById(orderId).select('orderNumber buyer targetQty dispatchedQty dispatchStatus');
  if (!order) return null;
  const orderNumber = order.orderNumber || '';
  const [onRack, dispatched, pipeline] = await Promise.all([
    DispatchBox.find({ productionOrderId: orderId, status: 'on-rack' }).sort({ updatedAt: -1 }),
    DispatchBox.find({ productionOrderId: orderId, status: 'dispatched' }).sort({ updatedAt: -1 }).limit(100),
    DispatchBox.find({
      productionOrderId: orderId,
      status: { $in: ['open', 'weighed', 'ready-for-dispatch'] },
    }).sort({ updatedAt: -1 }),
  ]);
  const mapRow = (row) => shapeDispatchBox(row, orderNumber);
  return {
    order: {
      id: String(order.id),
      orderNumber,
      buyer: order.buyer || '',
      targetQty: order.targetQty || 0,
      dispatchedQty: order.dispatchedQty || 0,
      dispatchStatus: order.dispatchStatus || 'none',
    },
    onRack: onRack.map(mapRow),
    dispatched: dispatched.map(mapRow),
    pipeline: pipeline.map(mapRow),
  };
};