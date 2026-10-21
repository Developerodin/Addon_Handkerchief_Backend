import { FloorCompletion } from '../models/production.model.js';
import { StockMovement } from '../models/store.model.js';
import { syncStatus } from './sync/sync.service.js';

/**
 * Counts completions once per event. A retried sync row is the same eventId, so it is not added twice.
 * @param {{ stage?: string, operatorId?: string }} filter
 */
export const completionReport = async (filter = {}) => {
  const query = {};
  if (filter.stage) query.stage = filter.stage;
  if (filter.operatorId) query.operatorId = filter.operatorId;
  const rows = await FloorCompletion.find(query);
  const qty = rows.reduce((sum, row) => sum + row.qty, 0);
  return { rows: rows.length, qty };
};

/**
 * Rolls whose latest scan is this rack.
 * @param {string} rackCode
 */
export const rackReport = async (rackCode) => {
  const rows = await StockMovement.find({ entityType: 'roll' }).sort({ createdAt: 1 });
  const latest = new Map();
  rows.forEach((row) => latest.set(row.entityId, row));
  const rolls = [];
  latest.forEach((row, barcode) => {
    if (row.toLocation === rackCode) rolls.push(barcode);
  });
  return { rackCode, rolls };
};

/**
 * Pending quantity is the sum of completions not yet matched by a later stage.
 * @param {string} stage
 */
export const stagePending = async (stage) => completionReport({ stage });

/**
 * Labels the board with the last successful sync so a stale number is visible.
 */
export const reportBoard = async () => {
  const status = await syncStatus();
  const cutting = await completionReport({ stage: 'single-piece-cutting' });
  return {
    lastSuccessAt: status.lastSuccessAt,
    pendingSync: status.pending,
    rp03: cutting,
    rp07: cutting,
  };
};
