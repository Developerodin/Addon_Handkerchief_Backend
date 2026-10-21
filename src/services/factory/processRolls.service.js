import mongoose from 'mongoose';
import httpStatus from 'http-status';
import ApiError from '../../utils/ApiError.js';
import { FabricLot, FabricRoll, GoodsReceipt, PurchaseOrder } from '../../models/store.model.js';

/**
 * The PO line stamped on a roll when the received lot names exactly one line.
 * @param {import('mongoose').Document} po
 * @param {{ lines?: Array<{ lineId: string }> }} lot
 */
function lineForLot(po, lot) {
  const ids = (lot.lines || []).map((line) => line.lineId).filter(Boolean);
  if (ids.length !== 1) return null;
  return po.lines.find((row) => row.lineId === ids[0]) || null;
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
 * Creates the missing roll barcodes for each received lot. Existing barcodes stay.
 * One roll per `rolls` count. Safe to call again.
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
  const fabricLot = await FabricLot.findOne({ poId: po.id }).sort({ createdAt: -1 });
  if (!fabricLot) throw new ApiError(httpStatus.BAD_REQUEST, 'Mark the order in transit before processing');

  const grn = await processReceipt(po, fabricLot, lots, user);
  let created = 0;
  for (const lot of lots) {
    const existing = await FabricRoll.countDocuments({ poId: po.id, receivedLotNumber: lot.lotNumber });
    const needed = Math.max(0, Number(lot.rolls) - existing);
    const line = lineForLot(po, lot);
    for (let index = 0; index < needed; index += 1) {
      const seq = existing + index + 1;
      await FabricRoll.create({
        barcode: new mongoose.Types.ObjectId().toString(),
        rollCode: `ROLL-${po.number}-${lot.lotNumber}-${seq}`,
        receivedLotNumber: lot.lotNumber,
        lotId: fabricLot.id,
        grnId: grn.id,
        poId: po.id,
        fabricId: line?.fabricId ? String(line.fabricId) : '',
        lineId: line?.lineId || '',
        fabricName: line?.fabricName || '',
        colourName: line?.colourName || '',
        scaleWeight: 0,
        grossWeight: 0,
        netWeight: 0,
        rate: line?.rate || 0,
        gstPercent: line?.gstPercent || 0,
      });
      created += 1;
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
