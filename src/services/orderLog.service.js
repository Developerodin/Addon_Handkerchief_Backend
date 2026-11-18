import { ProductionOrderLog } from '../models/production.model.js';
import { sessionOptions } from '../utils/mongoTransaction.js';

/**
 * Name and id stored on an activity row. Missing user stays blank.
 * @param {object | null | undefined} user
 */
export const actorOf = (user) => ({
  userId: user ? String(user.id || user._id || '') : '',
  userName: user?.name || user?.email || '',
});

/**
 * Appends one activity row. Store events may omit orderId.
 * @param {object} entry
 * @param {object | null | undefined} [user]
 * @param {import('mongoose').ClientSession | null} [session]
 */
export const writeOrderLog = async (entry, user, session = null) => {
  const actor = actorOf(user);
  const doc = {
    action: entry.action,
    userId: entry.userId || actor.userId,
    userName: entry.userName || actor.userName,
    entityType: entry.entityType,
    entityCode: entry.entityCode || '',
    quantity: entry.quantity ?? 1,
    fromLocation: entry.fromLocation || '',
    toLocation: entry.toLocation || '',
    remarks: entry.remarks || '',
    at: entry.at || new Date(),
  };
  if (entry.orderId) doc.orderId = entry.orderId;
  const created = await ProductionOrderLog.create([doc], sessionOptions(session));
  return created[0];
};
