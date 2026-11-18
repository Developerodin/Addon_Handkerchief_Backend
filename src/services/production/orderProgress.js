import { QualityResult } from '../../models/quality.model.js';
import { ProductionOrder } from '../../models/production.model.js';
import { sessionOptions } from '../../utils/mongoTransaction.js';
import { writeOrderLog } from '../orderLog.service.js';

const FINAL_CHECKING = 'final-checking';

/**
 * Sum of good pcs recorded at final checking for one order.
 * @param {string} orderId
 */
export async function finalCheckingGoodSum(orderId) {
  const oid = String(orderId);
  const rows = await QualityResult.aggregate([
    { $match: { kind: FINAL_CHECKING, orderId: oid } },
    { $group: { _id: null, good: { $sum: '$goodQty' } } },
  ]);
  return rows[0]?.good || 0;
}

/**
 * After final checking, roll up packing good qty onto the order and close when target is met.
 * @param {string} orderId
 * @param {object | null} [user]
 * @param {import('mongoose').ClientSession | null} [session]
 */
export async function syncOrderFromFinalChecking(orderId, user, session) {
  const q = ProductionOrder.findById(orderId);
  if (session) q.session(session);
  const order = await q;
  if (!order) return null;

  const goodSum = await finalCheckingGoodSum(orderId);
  const target = Number(order.targetQty) || 0;

  const stampFloor = (floors) => {
    if (!floors?.length) return;
    const step = floors.find((row) => row.floor === FINAL_CHECKING);
    if (step) step.completedQty = goodSum;
  };
  stampFloor(order.floors);
  (order.lines || []).forEach((line) => stampFloor(line.floors));

  const segment = order.segments?.[order.segments.length - 1];
  if (segment) segment.completedQty = goodSum;
  (order.lines || []).forEach((line) => {
    const lineSeg = line.segments?.[line.segments.length - 1];
    if (lineSeg) lineSeg.completedQty = goodSum;
  });

  const wasClosed = order.status === 'closed';
  if (goodSum >= target && target > 0) {
    order.status = 'closed';
    order.currentFloor = '';
  } else if (order.status === 'released') {
    order.status = 'in-progress';
  }

  await order.save(sessionOptions(session));

  if (!wasClosed && order.status === 'closed') {
    await writeOrderLog(
      {
        action: 'floor-complete',
        orderId: order.id,
        entityType: 'order',
        entityCode: FINAL_CHECKING,
        quantity: goodSum,
        remarks: 'Order completed after final checking',
      },
      user,
      session
    );
  }

  return { goodSum, targetQty: target, closed: order.status === 'closed' };
}