import { PieceBundle, ProductionOrder } from '../../models/production.model.js';

const NOT_CHECKED = {
  closed: true,
  barcode: { $nin: ['', null] },
  rackCode: { $nin: ['', null] },
  checkedGood: { $ne: true },
  $or: [{ process: 'created' }, { process: '' }, { process: null }, { process: { $exists: false } }],
};

/**
 * Closed bundles on a rack that single piece cutting has handed over and floor checks has not taken.
 */
export const upcomingFloorChecks = async () => {
  const rows = await PieceBundle.find(NOT_CHECKED).sort({ updatedAt: -1 }).limit(200);
  const orders = await ProductionOrder.find({ _id: { $in: rows.map((row) => row.orderId) } }).select('orderNumber');
  const numbers = new Map(orders.map((order) => [String(order.id), order.orderNumber || '']));
  return {
    results: rows.map((row) => ({
      id: String(row.id),
      barcode: row.barcode,
      orderId: String(row.orderId),
      orderNumber: numbers.get(String(row.orderId)) || '',
      qty: row.qty || 0,
      rackCode: row.rackCode || '',
    })),
    counts: { waiting: rows.length },
  };
};
