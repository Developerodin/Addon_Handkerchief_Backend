import mongoose from 'mongoose';
import httpStatus from 'http-status';
import ApiError from '../../utils/ApiError.js';
import { FabricLot, FabricRoll, GoodsReceipt, PurchaseOrder } from '../../models/store.model.js';

/**
 * Rolls to mint for one PO item.
 * A lot saved before per-item rolls, with a single line, still uses the lot total.
 * @param {{ rolls?: number, lines?: Array<{ rolls?: number }> }} lot
 * @param {{ rolls?: number }} line
 * @param {number} lineCount
 */
function rollsForLine(lot, line, lineCount) {
  if (Number(line.rolls) > 0) return Number(line.rolls);
  if (lineCount === 1) return Number(lot.rolls) || 0;
  return 0;
}

/**
 * Highest roll sequence already used on this lot. Codes are `ROLL-{po}-{lot}-{seq}`.
 * @param {Array<{ rollCode?: string }>} rolls
 * @param {string} poNumber
 * @param {string} lotNumber
 */
function nextRollSequence(rolls, poNumber, lotNumber) {
  const prefix = `ROLL-${poNumber}-${lotNumber}-`;
  return rolls.reduce((max, roll) => {
    if (!String(roll.rollCode || '').startsWith(prefix)) return max;
    const seq = Number(String(roll.rollCode).slice(prefix.length));
    return Number.isFinite(seq) && seq > max ? seq : max;
  }, 0);
}

/**
 * Drops unlabeled rolls from the old lot-wide barcode pass when none of them have been weighed.
 * A weighed unlabeled roll stays, and that lot is not given a second barcode set.
 * @param {import('mongoose').Types.ObjectId} poId
 * @param {string} lotNumber
 * @returns {Promise<'clear' | 'blocked'>}
 */
async function clearUnlabeledRolls(poId, lotNumber) {
  const unlabeled = await FabricRoll.find({
    poId,
    receivedLotNumber: lotNumber,
    $or: [{ lineId: '' }, { lineId: null }, { lineId: { $exists: false } }],
  });
  if (!unlabeled.length) return 'clear';
  if (unlabeled.some((roll) => Number(roll.netWeight) > 0)) return 'blocked';
  await FabricRoll.deleteMany({ _id: { $in: unlabeled.map((roll) => roll._id) } });
  return 'clear';
}

/**
 * One goods receipt that owns the barcodes created from Process.
 * @param {import('mongoose').Document} po
 * @param {import('mongoose').Document} fabricLot
 * @param {object[]} lots
 * @param {object | null} user
 */
async function processReceipt(po, fabricLot, lots, user) {
  const eventId = `process:${po.id}`;
  const existing = await GoodsReceipt.findOne({ eventId });
  if (existing) return existing;
  return GoodsReceipt.create({
    number: `GRN-${po.number}-P`,
    eventId,
    lotId: fabricLot.id,
    poId: po.id,
    netWeight: lots.reduce((sum, lot) => sum + (Number(lot.netWeight) || 0), 0),
    grossWeight: lots.reduce((sum, lot) => sum + (Number(lot.grossWeight) || 0), 0),
    receiver: user?.name || user?.email || '',
    supplierName: po.supplierName,
    supplierAddress: po.supplierAddress,
    supplierTerms: po.supplierTerms,
  });
}

/**
 * Creates the missing roll barcodes for each PO item on each received lot.
 * Existing barcodes for that item stay. Safe to call again.
 * @param {string} poId
 * @param {object | null} [user]
 */
export async function ensureProcessRolls(poId, user) {
  const po = await PurchaseOrder.findById(poId);
  if (!po) throw new ApiError(httpStatus.NOT_FOUND, 'Purchase order not found');
  if (!['Partially Received', 'Received'].includes(po.status)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Mark the goods received before processing');
  }
  const lots = (po.receivedLots || []).filter((lot) => lot.lotNumber && Number(lot.rolls) > 0);
  if (!lots.length) throw new ApiError(httpStatus.BAD_REQUEST, 'Add received lot rolls before processing');
  const missing = lots.find((lot) => (lot.lines || []).length > 1 && !(lot.lines || []).some((line) => Number(line.rolls) > 0));
  if (missing) {
    throw new ApiError(httpStatus.BAD_REQUEST, `Lot ${missing.lotNumber}: enter received rolls on each PO item`);
  }
  const fabricLot = await FabricLot.findOne({ poId: po.id }).sort({ createdAt: -1 });
  if (!fabricLot) throw new ApiError(httpStatus.BAD_REQUEST, 'Mark the order in transit before processing');

  const grn = await processReceipt(po, fabricLot, lots, user);
  let created = 0;
  for (const lot of lots) {
    const unlabeled = await clearUnlabeledRolls(po.id, lot.lotNumber);
    if (unlabeled === 'blocked') continue;
    const stored = await FabricRoll.find({ poId: po.id, receivedLotNumber: lot.lotNumber }).select('rollCode lineId');
    let seq = nextRollSequence(stored, po.number, lot.lotNumber);
    const lines = lot.lines || [];
    for (const lotLine of lines) {
      const wanted = rollsForLine(lot, lotLine, lines.length);
      if (!(wanted > 0) || !lotLine.lineId) continue;
      const line = po.lines.find((row) => row.lineId === lotLine.lineId);
      if (!line) continue;
      const existing = stored.filter((roll) => roll.lineId === lotLine.lineId).length;
      const needed = Math.max(0, wanted - existing);
      for (let index = 0; index < needed; index += 1) {
        seq += 1;
        await FabricRoll.create({
          barcode: new mongoose.Types.ObjectId().toString(),
          rollCode: `ROLL-${po.number}-${lot.lotNumber}-${seq}`,
          receivedLotNumber: lot.lotNumber,
          lotId: fabricLot.id,
          grnId: grn.id,
          poId: po.id,
          fabricId: line.fabricId ? String(line.fabricId) : '',
          lineId: line.lineId,
          fabricName: line.fabricName || '',
          colourName: line.colourName || '',
          scaleWeight: 0,
          grossWeight: 0,
          netWeight: 0,
          rate: line.rate || 0,
          gstPercent: line.gstPercent || 0,
        });
        created += 1;
      }
    }
  }
  const rolls = await FabricRoll.find({ poId: po.id }).sort({ createdAt: 1 });
  return { created, rolls };
}

/**
 * Stores the weighed gross and net for one process roll. Net is the stock weight.
 * @param {string} rollId
 * @param {{ grossWeight?: number, netWeight?: number }} body
 */
export async function updateProcessRoll(rollId, body) {
  const roll = await FabricRoll.findById(rollId);
  if (!roll) throw new ApiError(httpStatus.NOT_FOUND, 'Roll not found');
  if (roll.status === 'returned-to-vendor') {
    throw new ApiError(httpStatus.BAD_REQUEST, 'This roll was returned and is view only');
  }
  if (body.grossWeight != null) roll.grossWeight = Number(body.grossWeight) || 0;
  if (body.netWeight != null) {
    roll.netWeight = Number(body.netWeight) || 0;
    roll.scaleWeight = roll.netWeight;
  }
  await roll.save();
  return roll;
}
