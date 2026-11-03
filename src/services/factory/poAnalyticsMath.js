/**
 * Shared arithmetic for the purchase-order ledger and the one-order dossier.
 */

const CLOSED = new Set(['Received', 'Completed', 'Rejected', 'Draft']);

/**
 * Three-decimal quantity used on the other store reports.
 * @param {number} value
 */
export function round3(value) {
  return Math.round((Number(value) || 0) * 1000) / 1000;
}

/**
 * Inclusive date range. A date-only `to` covers that whole day.
 * @param {{ from?: string, to?: string }} query
 */
export function dateRange(query) {
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
 * Blank supplier names stay visible as their own row.
 * @param {unknown} name
 */
export function supplierLabel(name) {
  const text = String(name || '').trim();
  return text || 'Unknown supplier';
}

/**
 * Ordered quantity on a purchase order.
 * @param {{ quantity?: number }[]} lines
 */
export function sumOrdered(lines) {
  return (lines || []).reduce((sum, line) => sum + (Number(line.quantity) || 0), 0);
}

/**
 * Received quantity stored on the purchase order's lots.
 * @param {{ lines?: { receivedQuantity?: number }[] }[]} lots
 */
export function sumReceivedLots(lots) {
  return (lots || []).reduce(
    (sum, lot) => sum + (lot.lines || []).reduce((inner, line) => inner + (Number(line.receivedQuantity) || 0), 0),
    0
  );
}

/**
 * Line value before tax.
 * @param {{ quantity?: number, rate?: number }} line
 */
export function lineAmount(line) {
  return (Number(line.quantity) || 0) * (Number(line.rate) || 0);
}

/**
 * Line value with GST added.
 * @param {{ quantity?: number, rate?: number, gstPercent?: number }} line
 */
export function lineAmountGst(line) {
  const amount = lineAmount(line);
  return amount + (amount * (Number(line.gstPercent) || 0)) / 100;
}

/**
 * Quantity still to come in. Never negative.
 * @param {number} ordered
 * @param {number} received
 */
export function stillDue(ordered, received) {
  return Math.max(0, (Number(ordered) || 0) - (Number(received) || 0));
}

/**
 * Whole days from one instant to another, using UTC dates.
 * @param {unknown} from
 * @param {unknown} to
 */
export function daysBetween(from, to) {
  const start = new Date(from);
  const end = new Date(to);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  const startUtc = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  const endUtc = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
  return Math.round((endUtc - startUtc) / 86400000);
}

/**
 * Monday of the UTC week, as YYYY-MM-DD.
 * @param {unknown} value
 */
export function weekKey(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const utc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const weekday = utc.getUTCDay();
  const offset = weekday === 0 ? -6 : 1 - weekday;
  utc.setUTCDate(utc.getUTCDate() + offset);
  return utc.toISOString().slice(0, 10);
}

/**
 * Median of a list of numbers. Even counts use the average of the two middle values.
 * @param {Array<number | null | undefined>} values
 */
export function median(values) {
  const nums = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!nums.length) return null;
  const mid = Math.floor(nums.length / 2);
  if (nums.length % 2) return nums[mid];
  return Math.round(((nums[mid - 1] + nums[mid]) / 2) * 10) / 10;
}

/**
 * An order is open when cloth is still due and the order was not closed or rejected.
 * @param {string} status
 * @param {number} due
 */
export function isOpenOrder(status, due) {
  if (CLOSED.has(status)) return false;
  return due > 0;
}

/**
 * Case-insensitive match on number, supplier, or fabric name.
 * @param {{ number?: string, supplierName?: string, lines?: { fabricName?: string }[] }} order
 * @param {string} needle
 */
export function matchesQuery(order, needle) {
  const hay = [order.number, order.supplierName, ...(order.lines || []).map((line) => line.fabricName)]
    .join(' ')
    .toLowerCase();
  return hay.includes(needle);
}
