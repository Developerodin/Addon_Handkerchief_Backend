import { ProductionOrderLog } from '../../models/production.model.js';

/**
 * Floor keys that match `ProductionOrder.floors[].floor`.
 * Log actions map to the floor where work was recorded.
 */
const ACTION_TO_FLOOR = {
  'vertical-cut': 'vertical-cut',
  'piece-place': 'vertical-cut',
  'selvage-done': 'selvage',
  'half-moon-done': 'half-moon',
  'vertical-hem-done': 'vertical-hem',
  'single-piece-start': 'single-piece-cutting',
  'single-piece-cut': 'single-piece-cutting',
  'single-piece-close': 'single-piece-cutting',
  'bundle-check-inspect': 'floor-check',
  'bundle-check': 'floor-check',
  'horizontal-hem-done': 'horizontal-hem',
  'inline-check-done': 'inline-check',
  'thread-cut-done': 'thread-cutting',
  'final-qc-inspect': 'final-qc',
  'final-qc': 'final-qc',
  'iron-done': 'ironing',
  'iron-after-done': 'ironing',
  'embroidery-done': 'embroidery',
  'embroidery-thread-cut-done': 'embroidery-thread-cut',
  'sticker-done': 'sticker',
  'to-ground': 'to-ground',
  'final-checking-inspect': 'final-checking',
  'final-checking': 'final-checking',
  'bundle-place': 'thread-cutting',
};

/**
 * Sum scanned work per floor from order activity logs (barcode floors).
 * @param {string} orderId
 * @param {{ floor: string, name?: string }[]} floors
 */
export async function floorWorkedFromLogs(orderId, floors = []) {
  const logs = await ProductionOrderLog.find({ orderId: String(orderId) })
    .select('action quantity')
    .lean();
  const byFloor = new Map();
  for (const log of logs) {
    const action = String(log.action || '');
    const key = ACTION_TO_FLOOR[action];
    if (!key) continue;
    const qty = Math.max(0, Number(log.quantity) || 0);
    byFloor.set(key, (byFloor.get(key) || 0) + qty);
  }
  return (floors || []).map((step) => ({
    floor: step.floor,
    name: step.name || step.floor,
    workedQty: byFloor.get(step.floor) || 0,
    receivedQty: step.receivedQty || 0,
    completedQty: step.completedQty || 0,
    transferredQty: step.transferredQty || 0,
  }));
}