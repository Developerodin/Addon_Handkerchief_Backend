import httpStatus from 'http-status';
import ApiError from '../../utils/ApiError.js';
import { FabricRoll, PurchaseOrder, StockMovement, VendorReturn } from '../../models/store.model.js';
import { saveStatus } from '../store.service.js';
import { writeOrderLog } from '../orderLog.service.js';

/**
 * Latest rack for a barcode, or an empty string when it was never stored.
 * @param {string} barcode
 */
async function rackLocation(barcode) {
  const row = await StockMovement.findOne({ entityType: 'roll', entityId: barcode }).sort({ createdAt: -1 });
  return row?.toLocation || '';
}

/**
 * Returns only QC-rejected rolls and writes a challan. The PO flips when every roll is back with the vendor.
 * @param {{ poId?: string, rollBarcodes?: string[], reason?: string, remarks?: string }} body
 * @param {object | null} [user]
 */
export const createVendorReturn = async (body, user) => {
  const po = await PurchaseOrder.findById(body.poId);
  if (!po) throw new ApiError(httpStatus.NOT_FOUND, 'Purchase order not found');
  const barcodes = [...new Set((body.rollBarcodes || []).map((code) => String(code).trim()).filter(Boolean))];
  if (!barcodes.length) throw new ApiError(httpStatus.BAD_REQUEST, 'Scan at least one rejected roll');
  const rolls = await FabricRoll.find({ poId: po.id, barcode: { $in: barcodes } });
  if (rolls.length !== barcodes.length) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Scan only rolls from this purchase order');
  }
  const notRejected = rolls.filter((roll) => roll.qcStatus !== 'rejected');
  if (notRejected.length) throw new ApiError(httpStatus.BAD_REQUEST, 'Only QC rejected rolls can be returned');
  const already = rolls.filter((roll) => roll.status === 'returned-to-vendor');
  if (already.length) throw new ApiError(httpStatus.BAD_REQUEST, 'One of these rolls was already returned');

  const count = await VendorReturn.countDocuments({ poId: po.id });
  const challanNumber = `RC-${po.number}-${String(count + 1).padStart(3, '0')}`;
  const weight = rolls.reduce((sum, roll) => sum + (Number(roll.netWeight) || 0), 0);
  const row = await VendorReturn.create({
    poId: po.id,
    grnId: rolls[0].grnId,
    reason: ['rejected', 'excess', 'wrong'].includes(body.reason) ? body.reason : 'rejected',
    rollBarcodes: barcodes,
    lotNumbers: [...new Set(rolls.map((roll) => roll.receivedLotNumber).filter(Boolean))],
    quantity: barcodes.length,
    weight,
    challanNumber,
    poNumber: po.number,
    supplierName: po.supplierName,
    remarks: String(body.remarks || '').trim(),
  });

  for (const roll of rolls) {
    const fromLocation = await rackLocation(roll.barcode);
    await StockMovement.create({
      entityType: 'roll',
      entityId: roll.barcode,
      kind: 'vendor-return',
      fromLocation,
      toLocation: 'vendor',
      quantity: 1,
    });
    roll.status = 'returned-to-vendor';
    await roll.save();
    await writeOrderLog(
      {
        action: 'vendor-return',
        entityType: 'roll',
        entityCode: roll.barcode,
        fromLocation,
        toLocation: 'vendor',
        remarks: row.remarks || row.reason,
      },
      user
    );
  }

  const open = await FabricRoll.countDocuments({ poId: po.id, status: { $ne: 'returned-to-vendor' } });
  if (open === 0) await saveStatus(po, 'Return to Vendor', challanNumber, user);
  return row;
};
