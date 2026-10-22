import { ProductionOrder } from '../../models/production.model.js';

const MISSING_NUMBER = {
  $or: [{ orderNumber: { $exists: false } }, { orderNumber: null }, { orderNumber: '' }],
};

/**
 * Next unused ORD-000001 style number. Does not assign numbers to old orders.
 * @returns {Promise<string>}
 */
const nextOrderNumber = async () => {
  const latest = await ProductionOrder.findOne({ orderNumber: /^ORD-\d{6}$/ })
    .sort({ orderNumber: -1 })
    .select('orderNumber')
    .lean();
  let next = latest ? Number(String(latest.orderNumber).slice(4)) : 0;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    next += 1;
    const orderNumber = `ORD-${String(next).padStart(6, '0')}`;
    const taken = await ProductionOrder.exists({ orderNumber });
    if (!taken) return orderNumber;
  }
  return `ORD-${String(Date.now()).slice(-6)}`;
};

/**
 * Gives ORD-000001, ORD-000002, … to orders saved before numbers existed.
 * Oldest order gets the lowest number.
 */
export const backfillOrderNumbers = async () => {
  const missing = await ProductionOrder.find(MISSING_NUMBER).sort({ createdAt: 1 }).select('_id');
  for (const order of missing) {
    const orderNumber = await nextOrderNumber();
    try {
      await ProductionOrder.updateOne({ _id: order._id, ...MISSING_NUMBER }, { $set: { orderNumber } });
    } catch (err) {
      if (err && err.code === 11000) continue;
      throw err;
    }
  }
};

/**
 * Next ORD-000001 number for a new order. Old orders are numbered first.
 * @returns {Promise<string>}
 */
export const allocateOrderNumber = async () => {
  await backfillOrderNumbers();
  return nextOrderNumber();
};
