import { PurchaseOrder } from '../../models/store.model.js';

/**
 * Next purchase order number for the current year, PO-2026-0001.
 * Older random codes are ignored, so the sequence starts at 0001.
 * @param {number} [year]
 * @returns {Promise<string>}
 */
export async function nextPurchaseOrderNumber(year = new Date().getFullYear()) {
  const prefix = `PO-${year}-`;
  const rows = await PurchaseOrder.find({ number: new RegExp(`^${prefix}\\d+$`) })
    .select('number')
    .lean();
  const maxSeq = rows.reduce((max, row) => {
    const seq = Number(String(row.number).slice(prefix.length));
    return Number.isInteger(seq) && seq > max ? seq : max;
  }, 0);
  return `${prefix}${String(maxSeq + 1).padStart(4, '0')}`;
}
