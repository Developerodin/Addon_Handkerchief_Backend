import { runTransaction, sessionOptions } from '../../utils/mongoTransaction.js';

/**
 * Commits a floor move (updateMany) and its audit log in one transaction.
 * @template T
 * @param {object} args
 * @param {import('mongoose').Model} args.Model
 * @param {object} args.filter
 * @param {object} args.update
 * @param {(session: import('mongoose').ClientSession | null) => Promise<unknown>} args.afterUpdate
 * @param {() => Promise<T>} args.load
 */
export const txnEntityUpdate = async ({ Model, filter, update, afterUpdate, load }) =>
  runTransaction(async (session) => {
    await Model.updateMany(filter, update, sessionOptions(session));
    await afterUpdate(session);
    return load(session);
  });