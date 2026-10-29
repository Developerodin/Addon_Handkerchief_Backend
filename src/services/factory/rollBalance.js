import httpStatus from 'http-status';
import ApiError from '../../utils/ApiError.js';
import { StockMovement } from '../../models/store.model.js';
import { actorOf } from '../orderLog.service.js';

const ON_FLOOR = new Set(['issued', 'on-floor']);

/**
 * Three-decimal kilograms or meters. Anything that is not a number becomes 0.
 * @param {unknown} value
 */
export function round3(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 1000) / 1000;
}

/**
 * True when this roll was stored before current balances existed.
 * `0` is a real balance. Only a missing net means uninitialized.
 * @param {{ currentNetWeight?: number | null }} roll
 */
export function balanceUnset(roll) {
  return roll.currentNetWeight == null;
}

/**
 * Fills current from received for a roll still in store, or zeroes it when the roll is already on the floor.
 * @param {import('mongoose').Document} roll
 */
export async function ensureCurrentBalance(roll) {
  if (!balanceUnset(roll)) return roll;
  const issued = ON_FLOOR.has(roll.status);
  roll.currentGrossWeight = issued ? 0 : Number(roll.grossWeight) || 0;
  roll.currentNetWeight = issued ? 0 : Number(roll.netWeight) || 0;
  roll.currentQtyMeters = issued ? 0 : Number(roll.qtyMeters) || 0;
  await roll.save();
  return roll;
}

/**
 * Barcodes that already have an issue movement. Received weights stay locked for these.
 * @param {string[]} barcodes
 * @returns {Promise<Set<string>>}
 */
export async function issuedBarcodeSet(barcodes) {
  if (!barcodes.length) return new Set();
  const rows = await StockMovement.distinct('entityId', {
    entityType: 'roll',
    kind: 'issue',
    entityId: { $in: barcodes },
  });
  return new Set(rows);
}

/**
 * True once any issue movement exists for this barcode.
 * @param {string} barcode
 */
export async function rollWasIssued(barcode) {
  const row = await StockMovement.exists({ entityType: 'roll', entityId: barcode, kind: 'issue' });
  return Boolean(row);
}

/**
 * The issue that is still out. A later return closes it.
 * @param {string} barcode
 */
export async function openIssueMovement(barcode) {
  const row = await StockMovement.findOne({
    entityType: 'roll',
    entityId: barcode,
    kind: { $in: ['issue', 'return-to-rack'] },
  }).sort({ createdAt: -1 });
  if (!row || row.kind !== 'issue') return null;
  return row;
}

/**
 * Caps a leftover against the open issue. Old issues with no meters fall back to received meters.
 * @param {object} roll
 * @param {object} issue
 * @param {{ grossWeight?: number, netWeight?: number, qtyMeters?: number }} body
 */
export function assertLeftover(roll, issue, body) {
  const gross = round3(body.grossWeight);
  const net = round3(body.netWeight);
  const meters = round3(body.qtyMeters);
  if (!(gross > 0) || !(net > 0) || !(meters > 0)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Leftover gross, net, and meters must be greater than 0');
  }
  const capGross = issue.grossWeight == null ? Number(roll.grossWeight) || 0 : Number(issue.grossWeight);
  const capNet = Number(issue.netWeight) > 0 ? Number(issue.netWeight) : Number(roll.netWeight) || 0;
  const capMeters = meterCap(roll, issue);
  if (gross > round3(capGross)) throw new ApiError(httpStatus.BAD_REQUEST, 'Leftover gross is above what was issued');
  if (net > round3(capNet)) throw new ApiError(httpStatus.BAD_REQUEST, 'Leftover net is above what was issued');
  if (capMeters != null && meters > round3(capMeters)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Leftover meters are above what was issued');
  }
  return { gross, net, meters };
}

/**
 * Meter cap for a return. Null means the issue never recorded meters and received meters are empty.
 * @param {object} roll
 * @param {object} issue
 */
function meterCap(roll, issue) {
  if (issue.qtyMeters != null) return Number(issue.qtyMeters);
  if (Number(roll.qtyMeters) > 0) return Number(roll.qtyMeters);
  return null;
}

/**
 * Writes an issue for the whole current balance, then zeroes that balance.
 * @param {import('mongoose').Document} roll
 * @param {object} movement fields besides the balance and the actor
 * @param {object | null} [user]
 */
export async function issueWholeBalance(roll, movement, user) {
  await ensureCurrentBalance(roll);
  if (!(Number(roll.currentNetWeight) > 0)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'This roll has no balance left');
  }
  const gross = round3(roll.currentGrossWeight);
  const net = round3(roll.currentNetWeight);
  const meters = round3(roll.currentQtyMeters);
  const actor = actorOf(user);
  const doc = {
    ...movement,
    entityType: 'roll',
    entityId: roll.barcode,
    kind: 'issue',
    quantity: 1,
    grossWeight: gross,
    netWeight: net,
    qtyMeters: meters,
    scaleWeight: net,
    userId: actor.userId,
    userName: actor.userName,
  };
  if (!doc.eventId) delete doc.eventId;
  if (!(meters > 0) && !(Number(roll.qtyMeters) > 0)) delete doc.qtyMeters;
  const saved = await StockMovement.create(doc);
  roll.currentGrossWeight = 0;
  roll.currentNetWeight = 0;
  roll.currentQtyMeters = 0;
  roll.status = 'issued';
  await roll.save();
  return saved;
}

/**
 * Puts the typed leftover back on the roll and records the return movement.
 * @param {import('mongoose').Document} roll
 * @param {{ rackCode?: string, grossWeight?: number, netWeight?: number, qtyMeters?: number, orderId?: string, lineId?: string, bomLineId?: string, fabricCatalogId?: string, fabricName?: string }} body
 * @param {object | null} [user]
 */
export async function returnRollBalance(roll, body, user) {
  if (!ON_FLOOR.has(roll.status)) throw new ApiError(httpStatus.BAD_REQUEST, 'This roll is not issued');
  const rackCode = String(body.rackCode || '').trim();
  if (!rackCode) throw new ApiError(httpStatus.BAD_REQUEST, 'Rack is required');
  await ensureCurrentBalance(roll);
  const issue = await openIssueMovement(roll.barcode);
  if (!issue) throw new ApiError(httpStatus.BAD_REQUEST, 'This roll has no open issue');
  const leftover = assertLeftover(roll, issue, body);
  const latest = await StockMovement.findOne({ entityType: 'roll', entityId: roll.barcode }).sort({ createdAt: -1 });
  const fromLocation = latest?.toLocation || '';
  const actor = actorOf(user);
  roll.currentGrossWeight = leftover.gross;
  roll.currentNetWeight = leftover.net;
  roll.currentQtyMeters = leftover.meters;
  roll.status = 'stored';
  await roll.save();
  const movement = await StockMovement.create({
    entityType: 'roll',
    entityId: roll.barcode,
    kind: 'return-to-rack',
    fromLocation,
    toLocation: rackCode,
    quantity: 1,
    grossWeight: leftover.gross,
    netWeight: leftover.net,
    qtyMeters: leftover.meters,
    scaleWeight: leftover.net,
    userId: actor.userId,
    userName: actor.userName,
    ...(body.orderId ? { orderId: body.orderId } : {}),
    ...(body.lineId ? { lineId: String(body.lineId) } : {}),
    ...(body.bomLineId ? { bomLineId: String(body.bomLineId) } : {}),
    ...(body.fabricCatalogId ? { fabricCatalogId: String(body.fabricCatalogId) } : {}),
    ...(body.fabricName ? { fabricName: String(body.fabricName) } : {}),
  });
  return { movement, fromLocation };
}
