import mongoose from 'mongoose';

/**
 * Short unique code for a document number or barcode.
 * @param {string} prefix
 * @returns {string}
 */
export const nextCode = (prefix) => `${prefix}-${new mongoose.Types.ObjectId().toString().slice(-8).toUpperCase()}`;
