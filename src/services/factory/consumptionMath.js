const MATCH_METRES = 0.001;

/* Accumulators add metres onto the bucket they were given. */
/* eslint-disable no-param-reassign */

/**
 * Three-decimal quantity used across the consumption report.
 * @param {number} value
 */
export function round3(value) {
  return Math.round((Number(value) || 0) * 1000) / 1000;
}

/**
 * ISO timestamp, or a blank string when the value is missing.
 * @param {unknown} value
 */
export function isoDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString();
}

/**
 * Case-insensitive fabric and order matching.
 * @param {unknown} name
 */
export function nameKey(name) {
  return String(name || '')
    .trim()
    .toLowerCase();
}

/**
 * Blank names stay visible instead of collapsing into one empty row.
 * @param {unknown} name
 * @param {string} fallback
 */
export function labelOf(name, fallback) {
  const text = String(name || '').trim();
  return text || fallback;
}

/**
 * Drops dates Mongo cannot query.
 * @param {object} query
 */
export function cleanQuery(query) {
  const next = { ...(query || {}) };
  if (next.from && Number.isNaN(new Date(next.from).getTime())) delete next.from;
  if (next.to && Number.isNaN(new Date(next.to).getTime())) delete next.to;
  return next;
}

/**
 * Zeroed issue and return counters.
 */
export function emptyUse() {
  return { issuedMeters: 0, returnedMeters: 0, issuedRolls: 0, returnedRolls: 0 };
}

/**
 * Report totals before any order has been added.
 */
export function zeroTotals() {
  return {
    bomMeters: 0,
    issuedMeters: 0,
    returnedMeters: 0,
    consumedMeters: 0,
    varianceMeters: 0,
    issuedRolls: 0,
    returnedRolls: 0,
    orders: 0,
    fabrics: 0,
    overCount: 0,
    underCount: 0,
    matchCount: 0,
  };
}

/**
 * Adds one aggregation bucket. A return stores the leftover, not the amount used.
 * @param {ReturnType<typeof emptyUse>} bucket
 * @param {string} kind
 * @param {{ meters?: number, rolls?: number }} row
 */
export function addUse(bucket, kind, row) {
  const meters = Number(row.meters) || 0;
  const rolls = Number(row.rolls) || 0;
  if (kind === 'issue') {
    bucket.issuedMeters += meters;
    bucket.issuedRolls += rolls;
    return;
  }
  if (kind === 'return-to-rack') {
    bucket.returnedMeters += meters;
    bucket.returnedRolls += rolls;
  }
}

/**
 * Over, short, or on the BOM. Match is within a thousandth of a metre.
 * @param {number} variance
 */
export function bandOf(variance) {
  if (variance > MATCH_METRES) return 'over';
  if (variance < -MATCH_METRES) return 'under';
  return 'match';
}

/**
 * Consumed and variance from issued, returned, and BOM metres.
 * @param {ReturnType<typeof emptyUse> & { bomMeters?: number }} bucket
 */
export function closeUse(bucket) {
  const issuedMeters = round3(bucket.issuedMeters);
  const returnedMeters = round3(bucket.returnedMeters);
  const consumedMeters = round3(issuedMeters - returnedMeters);
  const bomMeters = round3(bucket.bomMeters || 0);
  const varianceMeters = round3(issuedMeters - bomMeters);
  return {
    bomMeters,
    issuedMeters,
    returnedMeters,
    consumedMeters,
    varianceMeters,
    issuedRolls: bucket.issuedRolls || 0,
    returnedRolls: bucket.returnedRolls || 0,
    band: bandOf(varianceMeters),
  };
}

/**
 * Sums order rows into the strip of KPI numbers.
 * @param {object[]} rows
 */
export function composeTotals(rows) {
  const totals = zeroTotals();
  const orders = new Set();
  const fabrics = new Set();
  rows.forEach((row) => {
    totals.bomMeters += row.bomMeters;
    totals.issuedMeters += row.issuedMeters;
    totals.returnedMeters += row.returnedMeters;
    totals.issuedRolls += row.issuedRolls;
    totals.returnedRolls += row.returnedRolls;
    orders.add(row.orderId);
    fabrics.add(nameKey(row.fabricName));
    if (row.band === 'over') totals.overCount += 1;
    else if (row.band === 'under') totals.underCount += 1;
    else totals.matchCount += 1;
  });
  const closed = closeUse(totals);
  return {
    ...closed,
    orders: orders.size,
    fabrics: fabrics.size,
    overCount: totals.overCount,
    underCount: totals.underCount,
    matchCount: totals.matchCount,
  };
}
