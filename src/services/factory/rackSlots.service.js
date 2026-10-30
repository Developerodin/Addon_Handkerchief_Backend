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
export async function findRack(key) {
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
 * Floor belongs in the code once.
 * ST-B-A02-L001 stays ST-B-A02-L001. A second trailing -B is removed.
 * A code saved without the floor, such as B1-02-R0001, becomes B1-02-R0001-F01.
 * @param {string} code
 * @param {string} floor
 * @returns {string}
 */
function rackCodeWithFloor(code, floor) {
  const parts = String(code || '').split('-').filter((part) => part.length > 0);
  while (parts.length > 1 && parts[parts.length - 1] === floor && parts.indexOf(floor) < parts.length - 1) {
    parts.pop();
  }
  if (floor && !parts.includes(floor)) parts.push(floor);
  return parts.join('-');
}

/**
 * Puts the floor on rack codes that were saved without it, and strips a duplicated trailing floor.
 * B1-02-R0001 with floor F01 becomes B1-02-R0001-F01. ST-B-A01-U001-B becomes ST-B-A01-U001.
 * Roll locations follow the renamed code.
 */
export async function stampFloorOntoCodes() {
  const racks = await StorageRack.find({ floor: { $regex: /\S/ } });
  for (const rack of racks) {
    const floorCode = normalizeFloor(rack.floor);
    if (!/^[A-Z0-9][A-Z0-9-]{0,24}$/.test(floorCode)) continue;
    const current = String(rack.code);
    const nextCode = rackCodeWithFloor(current, floorCode);
    if (nextCode === current) {
      if (rack.floor !== floorCode) await StorageRack.updateOne({ _id: rack._id }, { floor: floorCode });
      continue;
    }
    const taken = await StorageRack.exists({ code: nextCode });
    if (taken) continue;
    const patch = { code: nextCode, floor: floorCode };
    if (!rack.name || rack.name === current) patch.name = nextCode;
    if (!rack.barcode || rack.barcode === current) patch.barcode = nextCode;
    await StorageRack.updateOne({ _id: rack._id }, patch);
    await StockMovement.updateMany({ toLocation: current }, { $set: { toLocation: nextCode } });
    await StockMovement.updateMany({ fromLocation: current }, { $set: { fromLocation: nextCode } });
    await ProductionOrderLog.updateMany({ toLocation: current }, { $set: { toLocation: nextCode } });
    await ProductionOrderLog.updateMany({ fromLocation: current }, { $set: { fromLocation: nextCode } });
  }
}

const TOKEN = /^[A-Z0-9]{1,6}$/;
const BLOCK = /^[A-Z]$/;
const MAX_CODES = 500;

/**
 * Whole number from a JSON body field. NaN when the value is not an integer.
 * @param {unknown} value
 */
function readInt(value) {
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) return Number(value.trim());
  return Number.NaN;
}

/**
 * Zero-pads a section number or rack index.
 * @param {number} value
 * @param {number} width
 */
function padNumber(value, width) {
  return String(value).padStart(width, '0');
}

/**
 * Builds ST-B-A01-U001 codes for one block. Upper and lower each start at 001.
 * Counts are how many of that kind should exist, not how many to append.
 * @param {{ location: string, floor: string, block: string, sectionStart: number, sectionCount: number, upperCount: number, lowerCount: number }} input
 */
export function buildRackCodes(input) {
  const codes = [];
  for (let offset = 0; offset < input.sectionCount; offset += 1) {
    const section = `${input.block}${padNumber(input.sectionStart + offset, 2)}`;
    for (let index = 1; index <= input.upperCount; index += 1) {
      codes.push(`${input.location}-${input.floor}-${section}-U${padNumber(index, 3)}`);
    }
    for (let index = 1; index <= input.lowerCount; index += 1) {
      codes.push(`${input.location}-${input.floor}-${section}-L${padNumber(index, 3)}`);
    }
  }
  return codes;
}

/**
 * Normalizes the add-racks form and rejects a range that cannot be generated.
 * @param {object} body
 */
function readRackPlan(body) {
  const location = String(body.location || '').trim().toUpperCase();
  const floor = normalizeFloor(body.floor);
  const block = String(body.block || '').trim().toUpperCase();
  const sectionStart = readInt(body.sectionStart);
  const sectionCount = readInt(body.sectionCount);
  const upperCount = readInt(body.upperCount);
  const lowerCount = readInt(body.lowerCount);
  if (!TOKEN.test(location)) throw new ApiError(httpStatus.BAD_REQUEST, 'Location must be letters and numbers');
  if (!TOKEN.test(floor)) throw new ApiError(httpStatus.BAD_REQUEST, 'Floor must be letters and numbers');
  if (!BLOCK.test(block)) throw new ApiError(httpStatus.BAD_REQUEST, 'Block must be one letter');
  if (!Number.isInteger(sectionStart) || sectionStart < 1 || sectionStart > 99) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'First section must be from 1 to 99');
  }
  if (!Number.isInteger(sectionCount) || sectionCount < 1) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Enter how many sections');
  }
  if (sectionStart + sectionCount - 1 > 99) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Section numbers must stay within 01–99');
  }
  if (!Number.isInteger(upperCount) || upperCount < 0 || upperCount > 99) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Upper racks must be from 0 to 99');
  }
  if (!Number.isInteger(lowerCount) || lowerCount < 0 || lowerCount > 99) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Lower racks must be from 0 to 99');
  }
  if (!upperCount && !lowerCount) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Enter upper racks, lower racks, or both');
  }
  if (sectionCount * (upperCount + lowerCount) > MAX_CODES) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Add at most 500 racks at once');
  }
  return { location, floor, block, sectionStart, sectionCount, upperCount, lowerCount };
}

/**
 * Creates missing fabric racks for a block section range. Codes look like ST-B-A01-U001.
 * Upper 2 means U001 and U002. A later upper 5 adds only U003 through U005.
 * @param {{ location?: string, floor?: string, block?: string, sectionStart?: number, sectionCount?: number, upperCount?: number, lowerCount?: number }} body
 */
export const addStorageRacks = async (body) => {
  const plan = readRackPlan(body);
  const codes = buildRackCodes(plan);
  await stampFloorOntoCodes();
  const existing = await StorageRack.find({ code: { $in: codes } }).select('code');
  const taken = new Set(existing.map((row) => row.code));
  const created = [];
  for (const code of codes) {
    if (taken.has(code)) continue;
    try {
      created.push(await StorageRack.create({
        code,
        name: code,
        location: plan.location,
        floor: plan.floor,
        zone: code.split('-')[2],
        stockType: 'fabric',
        barcode: code,
        status: 'active',
      }));
    } catch (err) {
      if (err && err.code === 11000) continue;
      throw err;
    }
  }
  return {
    results: created.map((rack) => rack.toJSON()),
    created: created.length,
    skipped: codes.length - created.length,
    totalResults: created.length,
  };
};

/**
 * True when a roll's latest movement still sits on this rack.
 * @param {string} rackCode
 */
async function rackHasRolls(rackCode) {
  const touched = await StockMovement.distinct('entityId', { entityType: 'roll', toLocation: rackCode });
  if (!touched.length) return false;
  const rows = await StockMovement.find({ entityType: 'roll', entityId: { $in: touched } })
    .sort({ createdAt: 1 })
    .select('entityId toLocation');
  const latest = new Map();
  rows.forEach((row) => latest.set(row.entityId, row.toLocation || ''));
  return [...latest.values()].some((location) => location === rackCode);
}

/**
 * Deletes a rack that has no fabric rolls on it. History rows stay.
 * @param {object} [_body]
 * @param {{ rackCode?: string }} [params]
 */
export const deleteStorageRack = async (_body, params = {}) => {
  const code = String(params.rackCode || '').trim().toUpperCase();
  if (!code) throw new ApiError(httpStatus.BAD_REQUEST, 'Rack is required');
  const rack = await StorageRack.findOne({ code });
  if (!rack) throw new ApiError(httpStatus.NOT_FOUND, 'Rack not found');
  if (await rackHasRolls(rack.code)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'This rack contains fabric rolls');
  }
  await StorageRack.deleteOne({ _id: rack._id });
  return { code: rack.code, deleted: true };
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
