import httpStatus from 'http-status';
import ApiError from '../../utils/ApiError.js';
import { FabricRoll, GoodsReceipt, PurchaseOrder } from '../../models/store.model.js';

/**
 * Inclusive date range. A date-only `to` covers that whole day.
 * @param {object} query
 */
function dateRange(query) {
  if (!query.from && !query.to) return null;
  const range = {};
  if (query.from) range.$gte = new Date(query.from);
  if (query.to) {
    const end = new Date(query.to);
    if (String(query.to).length <= 10) end.setHours(23, 59, 59, 999);
    range.$lte = end;
  }
  return range;
}

/**
 * One GRN with its rolls and the purchase order it belongs to.
 * @param {string} id
 */
export const getReceipt = async (id) => {
  const grn = await GoodsReceipt.findById(id);
  if (!grn) throw new ApiError(httpStatus.NOT_FOUND, 'GRN not found');
  const [rolls, order] = await Promise.all([
    FabricRoll.find({ grnId: grn.id }).sort({ rollCode: 1 }),
    PurchaseOrder.findById(grn.poId),
  ]);
  return { grn, rolls, order };
};

/**
 * Edits the operational header. Rates and GST stay on the purchase order.
 * @param {string} id
 * @param {object} body
 */
export const updateReceipt = async (id, body) => {
  const grn = await GoodsReceipt.findById(id);
  if (!grn) throw new ApiError(httpStatus.NOT_FOUND, 'GRN not found');
  if (body.receivedDate) grn.receivedDate = new Date(body.receivedDate);
  if (body.receiver != null) grn.receiver = String(body.receiver);
  if (body.condition != null) grn.condition = String(body.condition);
  if (body.notes != null) grn.notes = String(body.notes);
  if (body.grossWeight != null) grn.grossWeight = Number(body.grossWeight) || 0;
  if (body.netWeight != null) grn.netWeight = Number(body.netWeight) || 0;
  await grn.save();
  return grn;
};

/**
 * Receipts grouped by month and supplier.
 * @param {object} query
 */
export const receiptSummary = async (query) => {
  const filter = {};
  const receivedDate = dateRange(query);
  if (receivedDate) filter.receivedDate = receivedDate;
  const rows = await GoodsReceipt.find(filter).sort({ receivedDate: -1 }).limit(1000);
  const groups = new Map();
  rows.forEach((row) => {
    const when = row.receivedDate ? new Date(row.receivedDate) : new Date();
    const month = `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, '0')}`;
    const supplier = row.supplierName || '—';
    const key = `${month}|${supplier}`;
    const current = groups.get(key) || { month, supplier, receipts: 0, netWeight: 0, grossWeight: 0 };
    current.receipts += 1;
    current.netWeight += Number(row.netWeight) || 0;
    current.grossWeight += Number(row.grossWeight) || 0;
    groups.set(key, current);
  });
  const results = [...groups.values()].sort((left, right) => right.month.localeCompare(left.month) || left.supplier.localeCompare(right.supplier));
  return { results, totalResults: results.length };
};
