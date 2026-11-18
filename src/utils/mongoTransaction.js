import mongoose from 'mongoose';

/**
 * @param {unknown} error
 */
export const isTransactionUnsupported = (error) => {
  const message = String(error?.message || '');
  return (
    error?.code === 20 ||
    message.includes('Transaction numbers are only allowed') ||
    (message.includes('transaction') && message.includes('replica set')) ||
    (message.includes('not support') && message.includes('transaction'))
  );
};

/**
 * Mongoose options when a session is active.
 * @param {import('mongoose').ClientSession | null | undefined} session
 */
export const sessionOptions = (session) => (session ? { session } : {});

/**
 * Runs work in one Mongo transaction when the server supports it.
 * On standalone MongoDB, runs once without a session (same behavior as publish).
 * @template T
 * @param {(session: import('mongoose').ClientSession | null) => Promise<T>} work
 * @returns {Promise<T>}
 */
export const runTransaction = async (work) => {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await work(session);
    });
    return /** @type {T} */ (result);
  } catch (error) {
    if (isTransactionUnsupported(error)) {
      console.warn('runTransaction: transactions unavailable, falling back to non-transactional write');
      return work(null);
    }
    throw error;
  } finally {
    session.endSession();
  }
};