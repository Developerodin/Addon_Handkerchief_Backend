import { writeOrderLog } from '../orderLog.service.js';

/**
 * One order log when every piece belongs to the same order.
 * @param {object[]} pieces
 * @param {object} entry
 * @param {object | null} user
 * @param {import('mongoose').ClientSession | null} [session]
 */
export const logPieces = (pieces, entry, user, session = null) => {
  const orderIds = new Set(pieces.map((piece) => String(piece.orderId)));
  return writeOrderLog(
    {
      ...entry,
      orderId: orderIds.size === 1 ? pieces[0].orderId : undefined,
      entityType: entry.entityType || 'roll',
      entityCode: entry.entityCode || pieces[0].barcode,
      quantity: entry.quantity ?? pieces.length,
    },
    user,
    session
  );
};