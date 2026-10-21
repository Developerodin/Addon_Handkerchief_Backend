import httpStatus from 'http-status';
import ApiError from '../../utils/ApiError.js';
import { FabricRoll, PurchaseOrder, StockMovement } from '../../models/store.model.js';
import { ProductionOrderLog } from '../../models/production.model.js';
import StorageRack from '../../models/storageRack.model.js';
import { writeOrderLog } from '../orderLog.service.js';

const OFF_RACK = new Set(['', 'floor', 'vendor', 'dispatched']);

/**
 * Latest basement rack for a roll barcode. Floor and vendor are not racks.
 * @param {string} barcode
 */
async function currentRack(barcode) {
  const row = await StockMovement.findOne({ entityType: 'roll', entityId: barcode }).sort({ createdAt: -1 });
  const location = row?.toLocation || '';
  return OFF_RACK.has(location) ? '' : location;
}

/**
 * Active rack matched by code or printed barcode.
 * @param {string} key
 */
async function findRack(key) {
  const code = String(key || '').trim();
  if (!code) return null;
  return StorageRack.findOne({
    status: 'active',
    $or: [{ code: code.toUpperCase() }, { barcode: code }, { barcode: code.toUpperCase() }],
  });
}

/**
 * Puts a QC-passed roll on a rack. Scan can be the roll barcode or the roll code.
 * @param {{ rollBarcode?: string, rackCode?: string, eventId?: string }} body
 * @param {object | null} [user]
 */
export const placeRoll = async (body, user) => {
  if (body.eventId) {
    const existing = await StockMovement.findOne({ eventId: body.eventId });
    if (existing) return existing;
  }
  const scanned = String(body.rollBarcode || '').trim();
  const roll = await FabricRoll.findOne({ $or: [{ barcode: scanned }, { rollCode: scanned }] });
  if (!roll) throw new ApiError(httpStatus.NOT_FOUND, 'Roll not found');
  if (roll.qcStatus !== 'passed') {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Only a QC-passed roll can be stored');
  }
  const rack = await findRack(body.rackCode);
  if (!rack) throw new ApiError(httpStatus.NOT_FOUND, 'Rack not found. Scan a rack barcode that exists.');
  const fromLocation = await currentRack(roll.barcode);
  if (fromLocation === rack.code) {
    return { rackCode: rack.code, rollBarcode: roll.barcode, alreadyThere: true };
  }
  const movement = await StockMovement.create({
    eventId: body.eventId,
    entityType: 'roll',
    entityId: roll.barcode,
    kind: 'rack',
    fromLocation,
    toLocation: rack.code,
    quantity: 1,
  });
  roll.status = 'stored';
  await roll.save();
  await writeOrderLog(
    {
      action: 'rack',
      entityType: 'roll',
      entityCode: roll.barcode,
      fromLocation,
      toLocation: rack.code,
      quantity: 1,
    },
    user
  );
  return { rackCode: rack.code, rollBarcode: roll.barcode, rollCode: roll.rollCode || '' };
};

/**
 * Takes a stored roll off its rack and returns it to unallocated.
 * @param {{ rollBarcode?: string, eventId?: string }} body
 * @param {object} [_params]
 * @param {object | null} [user]
 */
export const unallocateRoll = async (body, _params, user) => {
  if (body.eventId) {
    const existing = await StockMovement.findOne({ eventId: body.eventId });
    if (existing) return existing;
  }
  const scanned = String(body.rollBarcode || '').trim();
  const roll = await FabricRoll.findOne({ $or: [{ barcode: scanned }, { rollCode: scanned }] });
  if (!roll) throw new ApiError(httpStatus.NOT_FOUND, 'Roll not found');
  const fromLocation = await currentRack(roll.barcode);
  if (!fromLocation) throw new ApiError(httpStatus.BAD_REQUEST, 'Roll is not on a rack');
  await StockMovement.create({
    eventId: body.eventId,
    entityType: 'roll',
    entityId: roll.barcode,
    kind: 'unallocate',
    fromLocation,
    toLocation: '',
    quantity: 1,
  });
  roll.status = 'received';
  await roll.save();
  await writeOrderLog(
    {
      action: 'rack',
      entityType: 'roll',
      entityCode: roll.barcode,
      fromLocation,
      toLocation: '',
      quantity: 1,
      remarks: 'unallocated',
    },
    user
  );
  return { rollBarcode: roll.barcode, rollCode: roll.rollCode || '', fromLocation };
};

/**
 * Floor token used in the rack code. "f 01" becomes F01.
 * @param {string} value
 */
function normalizeFloor(value) {
  return String(value || '').trim().toUpperCase().replace(/\s+/g, '');
}

/**
 * Escapes a code fragment for a RegExp.
 * @param {string} value
 */
function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Puts the floor on rack codes that were saved without it.
 * B1-02-R0001 with floor F01 becomes B1-02-R0001-F01, and roll locations follow.
 */
export async function stampFloorOntoCodes() {
  const racks = await StorageRack.find({ floor: { $regex: /\S/ } });
  for (const rack of racks) {
    const floorCode = normalizeFloor(rack.floor);
    if (!/^[A-Z0-9][A-Z0-9-]{0,24}$/.test(floorCode)) continue;
    const current = String(rack.code);
    if (current.endsWith(`-${floorCode}`)) {
      if (rack.floor !== floorCode) await StorageRack.updateOne({ _id: rack._id }, { floor: floorCode });
      continue;
    }
    const nextCode = `${current}-${floorCode}`;
    const taken = await StorageRack.exists({ code: nextCode });
    if (taken) continue;
    await StorageRack.updateOne({ _id: rack._id }, { code: nextCode, name: nextCode, barcode: nextCode, floor: floorCode });
    await StockMovement.updateMany({ toLocation: current }, { $set: { toLocation: nextCode } });
    await StockMovement.updateMany({ fromLocation: current }, { $set: { fromLocation: nextCode } });
    await ProductionOrderLog.updateMany({ toLocation: current }, { $set: { toLocation: nextCode } });
    await ProductionOrderLog.updateMany({ fromLocation: current }, { $set: { fromLocation: nextCode } });
  }
}

/**
 * Creates the next N fabric racks in a section and floor. Codes look like B1-02-R0001-F01.
 * The rack number continues per section and floor.
 * @param {{ zone?: string, section?: string, floor?: string, count?: number }} body
 */
export const addStorageRacks = async (body) => {
  const zone = String(body.zone || body.section || '').trim().toUpperCase();
  const floor = normalizeFloor(body.floor);
  const count = Math.min(50, Math.max(1, parseInt(body.count, 10) || 0));
  if (!/^[A-Z0-9][A-Z0-9-]{0,24}$/.test(zone)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Section must be letters, numbers, and dashes');
  }
  if (!/^[A-Z0-9][A-Z0-9-]{0,24}$/.test(floor)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Floor must be letters, numbers, and dashes');
  }
  if (!count) throw new ApiError(httpStatus.BAD_REQUEST, 'Enter how many racks to add');
  await stampFloorOntoCodes();
  const rows = await StorageRack.find({ code: new RegExp(`^${escapeRegex(zone)}-R\\d+-${escapeRegex(floor)}$`) }).select('code');
  let next = 1;
  rows.forEach((row) => {
    const match = String(row.code).match(/-R(\d+)-/);
    if (match) next = Math.max(next, Number(match[1]) + 1);
  });
  const created = [];
  for (let index = 0; index < count; index += 1) {
    const code = `${zone}-R${String(next + index).padStart(4, '0')}-${floor}`;
    created.push(await StorageRack.create({
      code,
      name: code,
      zone,
      floor,
      stockType: 'fabric',
      barcode: code,
      status: 'active',
    }));
  }
  return { results: created.map((rack) => rack.toJSON()), totalResults: created.length };
};

/**
 * Rolls currently sitting on a rack, with weight and purchase order, for the storage report.
 */
export const storageReport = async () => {
  const rows = await StockMovement.find({ entityType: 'roll' }).sort({ createdAt: 1 });
  const latest = new Map();
  rows.forEach((row) => latest.set(row.entityId, row));
  const placed = [];
  latest.forEach((row, barcode) => {
    if (!OFF_RACK.has(row.toLocation || '')) placed.push({ barcode, rackCode: row.toLocation });
  });
  const barcodes = placed.map((row) => row.barcode);
  const rolls = barcodes.length ? await FabricRoll.find({ barcode: { $in: barcodes } }) : [];
  const byBarcode = new Map(rolls.map((roll) => [roll.barcode, roll]));
  const poIds = [...new Set(rolls.map((roll) => String(roll.poId || '')).filter(Boolean))];
  const orders = poIds.length ? await PurchaseOrder.find({ _id: { $in: poIds } }).select('number') : [];
  const poNumbers = new Map(orders.map((order) => [String(order._id), order.number]));
  const racks = await StorageRack.find({ status: 'active' }).select('code floor zone');
  const rackMeta = new Map(racks.map((rack) => [rack.code, rack]));
  const results = placed.flatMap(({ barcode, rackCode }) => {
    const roll = byBarcode.get(barcode);
    if (!roll) return [];
    const rack = rackMeta.get(rackCode);
    return [{
      barcode: roll.barcode,
      rollCode: roll.rollCode || '',
      fabricName: roll.fabricName || '',
      colourName: roll.colourName || '',
      lotNumber: roll.receivedLotNumber || '',
      grossWeight: roll.grossWeight || 0,
      netWeight: roll.netWeight || 0,
      poNumber: poNumbers.get(String(roll.poId)) || '',
      rackCode,
      floor: rack?.floor || '',
      section: rack?.zone || '',
    }];
  });
  return { results, totalResults: results.length };
};
