import { cutoffKey } from './cutoffGate.js';
import { daysBetween, isOpenOrder, lineAmount, round3, stillDue, sumOrdered, sumReceivedLots } from './poAnalyticsMath.js';

const OFF_RACK = new Set(['', 'floor', 'vendor', 'dispatched']);

/**
 * @param {unknown} value
 */
function idOf(value) {
  return value ? String(value) : '';
}

/**
 * Received quantity per line. Lot lines win; rolls are the fallback.
 * @param {{ receivedLots?: { lines?: { lineId: string, receivedQuantity?: number }[] }[] }} order
 * @param {{ lineId?: string, scaleWeight?: number }[]} rolls
 */
function receivedByLine(order, rolls) {
  const fromLots = new Map();
  (order.receivedLots || []).forEach((lot) => {
    (lot.lines || []).forEach((line) => {
      fromLots.set(line.lineId, (fromLots.get(line.lineId) || 0) + (Number(line.receivedQuantity) || 0));
    });
  });
  if (sumReceivedLots(order.receivedLots) > 0) return fromLots;
  const fromRolls = new Map();
  rolls.forEach((roll) => {
    if (!roll.lineId) return;
    fromRolls.set(roll.lineId, (fromRolls.get(roll.lineId) || 0) + (Number(roll.scaleWeight) || 0));
  });
  return fromRolls;
}

/**
 * Fabric name for a cutoff key, taken from the order lines.
 * @param {{ lines?: object[] }} order
 */
function fabricNameFor(order) {
  const names = new Map();
  (order.lines || []).forEach((line) => {
    names.set(cutoffKey(line), line.fabricName || line.lineId);
  });
  return names;
}

/**
 * Ordered, received, and cutoff state for each line.
 * @param {object} order
 * @param {object[]} rolls
 * @param {Set<string>} approved
 */
export function buildLines(order, rolls, approved) {
  const received = receivedByLine(order, rolls);
  return (order.lines || []).map((line) => {
    const ordered = Number(line.quantity) || 0;
    const got = received.get(line.lineId) || 0;
    return {
      lineId: line.lineId,
      fabricName: line.fabricName || '',
      fabricSortNo: line.fabricSortNo || '',
      colourName: line.colourName || '',
      unitName: line.unitName || '',
      ordered: round3(ordered),
      received: round3(got),
      stillDue: round3(stillDue(ordered, got)),
      rate: Number(line.rate) || 0,
      gstPercent: Number(line.gstPercent) || 0,
      value: round3(lineAmount(line)),
      cutoff: approved.has(cutoffKey(line)) ? 'Approved' : 'Waiting',
    };
  });
}

/**
 * Lot approval. Older lots have no person on the record.
 * @param {object[]} lots
 * @param {Map<string, string>} fabricNames
 */
export function buildLots(lots, fabricNames) {
  return lots.map((lot) => ({
    id: idOf(lot._id),
    status: lot.status,
    qcStatus: lot.qcStatus || 'pending',
    approvedBy: lot.approvedBy || '',
    approvedAt: lot.approvedAt || null,
    approver: lot.status === 'approved' ? lot.approvedBy || 'Approver was not recorded' : '',
    cutoffs: (lot.cutoffs || []).map((row) => ({
      fabricId: row.fabricId,
      fabricName: fabricNames.get(String(row.fabricId)) || row.fabricId,
      approved: Boolean(row.approved),
    })),
  }));
}

/**
 * Packing list fields the store actually files.
 * @param {object[]} lists
 */
export function buildPacking(lists) {
  return lists.map((list) => {
    const cartons = list.cartons || [];
    const net = cartons.reduce((sum, carton) => sum + (Number(carton.netWeight) || 0), 0);
    const gross = cartons.reduce((sum, carton) => sum + (Number(carton.grossWeight) || 0), 0);
    return {
      id: idOf(list._id),
      code: list.packingListCode,
      shipmentDate: list.shipmentDate,
      expectedDelivery: list.expectedDelivery,
      invoiceNumber: list.invoiceNumber || '',
      invoiceDate: list.invoiceDate || null,
      lrNo: list.lrNo || '',
      lrDate: list.lrDate || null,
      courierName: list.courierName || '',
      courierNumber: list.courierNumber || '',
      vehicleNumber: list.vehicleNumber || '',
      challanNumber: list.challanNumber || '',
      cartons: cartons.length,
      rolls: Number(list.rolls) || 0,
      boxes: Number(list.boxes) || 0,
      netWeight: round3(net || Number(list.weight) || 0),
      grossWeight: round3(gross || Number(list.weight) || 0),
      notes: list.notes || '',
    };
  });
}

/**
 * Goods receipts and the QC written on received lots.
 * @param {object[]} receipts
 * @param {{ lotNumber: string, qcStatus?: string, qcBy?: string, qcAt?: Date, qcRemarks?: string, rolls?: number, netWeight?: number, grossWeight?: number }[]} receivedLots
 */
export function buildReceipts(receipts, receivedLots) {
  return {
    receipts: receipts.map((row) => ({
      id: idOf(row._id),
      number: row.number,
      receivedDate: row.receivedDate,
      receiver: row.receiver || '',
      netWeight: round3(row.netWeight),
      grossWeight: round3(row.grossWeight),
      condition: row.condition || '',
      notes: row.notes || '',
    })),
    qc: (receivedLots || []).map((lot) => ({
      lotNumber: lot.lotNumber,
      qcStatus: lot.qcStatus || 'pending',
      qcBy: lot.qcBy || '',
      qcAt: lot.qcAt || null,
      qcRemarks: lot.qcRemarks || '',
      rolls: lot.rolls || 0,
      netWeight: round3(lot.netWeight),
      grossWeight: round3(lot.grossWeight),
    })),
  };
}

/**
 * Latest location that is still a rack. Floor and vendor are not racks.
 * @param {Map<string, string>} locations
 * @param {object[]} rolls
 */
export function buildStorage(locations, rolls) {
  const groups = new Map();
  let unstored = 0;
  rolls.forEach((roll) => {
    const location = locations.get(roll.barcode) || '';
    const rack = OFF_RACK.has(location) ? '' : location;
    if (!rack) unstored += 1;
    const key = rack || 'Not on a rack';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({
      barcode: roll.barcode,
      fabricName: roll.fabricName || '',
      colourName: roll.colourName || '',
      status: roll.status,
      scaleWeight: round3(roll.scaleWeight),
      netWeight: round3(roll.netWeight),
      qtyMeters: round3(roll.qtyMeters),
    });
  });
  const racks = [...groups.entries()]
    .map(([rack, items]) => ({ rack, count: items.length, rolls: items }))
    .sort((a, b) => a.rack.localeCompare(b.rack));
  return { unstored, racks };
}

/**
 * A date picker stores midnight UTC. That is a day, not a clock time.
 * @param {unknown} value
 */
function isDateOnly(value) {
  const time = new Date(value);
  return (
    time.getUTCHours() === 0 &&
    time.getUTCMinutes() === 0 &&
    time.getUTCSeconds() === 0 &&
    time.getUTCMilliseconds() === 0
  );
}

/**
 * @param {object[]} events
 * @param {unknown} at
 * @param {string} label
 * @param {string} [detail]
 */
function pushEvent(events, at, label, detail = '') {
  const time = new Date(at);
  if (!at || Number.isNaN(time.getTime())) return;
  const dateOnly = isDateOnly(at);
  const sortAt = dateOnly
    ? new Date(Date.UTC(time.getUTCFullYear(), time.getUTCMonth(), time.getUTCDate(), 23, 59, 59))
    : time;
  events.push({ at: time.toISOString(), sortAt: sortAt.toISOString(), label, detail, dateOnly });
}

/**
 * Status changes, packing, first and last receipt, and the first rack placement.
 * @param {object} order
 * @param {object[]} packing
 * @param {object[]} receipts
 * @param {{ at: Date, rack: string } | null} firstRack
 */
export function buildTimeline(order, packing, receipts, firstRack) {
  const events = [];
  (order.statusHistory || []).forEach((row) => {
    const who = row.userName ? `By ${row.userName}` : '';
    const remarks = row.remarks || '';
    pushEvent(events, row.at, row.status || 'Status', [who, remarks].filter(Boolean).join(' · '));
  });
  packing.forEach((list) => {
    pushEvent(events, list.shipmentDate, `Packing list ${list.packingListCode || ''}`.trim(), list.challanNumber || '');
  });
  const dated = receipts
    .map((row) => ({ ...row, time: new Date(row.receivedDate) }))
    .filter((row) => !Number.isNaN(row.time.getTime()))
    .sort((a, b) => a.time - b.time);
  const ends = dated.length > 1 ? [dated[0], dated[dated.length - 1]] : dated;
  ends.forEach((row, index) => {
    const which = dated.length > 1 && index === ends.length - 1 ? 'Last receipt' : 'Receipt';
    pushEvent(events, row.receivedDate, `${which} ${row.number || ''}`.trim(), row.receiver ? `Received by ${row.receiver}` : '');
  });
  if (firstRack) pushEvent(events, firstRack.at, `Stored on ${firstRack.rack}`);
  events.sort((a, b) => a.sortAt.localeCompare(b.sortAt));
  return events.map((event, index) => ({
    at: event.at,
    label: event.label,
    detail: event.detail,
    dateOnly: event.dateOnly,
    daysAfterPrevious: index === 0 ? null : daysBetween(events[index - 1].at, event.at),
  }));
}

/**
 * Days from the order date to the first receipt, and to today while it is still open.
 * @param {object} order
 * @param {Date | null} firstReceipt
 * @param {number} received
 */
export function buildCycle(order, firstReceipt, received) {
  const ordered = sumOrdered(order.lines);
  const open = isOpenOrder(order.status, stillDue(ordered, received));
  return {
    daysToFirstReceipt: firstReceipt ? daysBetween(order.purchaseDate, firstReceipt) : null,
    daysOpen: open ? daysBetween(order.purchaseDate, new Date()) : null,
  };
}

/**
 * Vendor returns raised against the order.
 * @param {object[]} rows
 */
export function buildReturns(rows) {
  return rows.map((row) => ({
    id: idOf(row._id),
    reason: row.reason,
    quantity: round3(row.quantity),
    challanNumber: row.challanNumber || '',
    issuedAt: row.issuedAt || null,
    remarks: row.remarks || '',
  }));
}
