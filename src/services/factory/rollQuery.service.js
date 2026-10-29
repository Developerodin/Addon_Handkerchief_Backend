import { FabricRoll, GoodsReceipt, PurchaseOrder, StockMovement } from '../../models/store.model.js';
import { pageOf, searchFilter } from '../factoryLists.service.js';
import { issuedBarcodeSet } from './rollBalance.js';

/**
 * Rolls, optionally with the rack they currently sit on.
 * Unallocated (passed + still received) only includes rolls whose lot is still passed.
 * @param {object} query
 */
export const listRolls = async (query) => {
  const page = await pageOf(FabricRoll, searchFilter(query, ['barcode', 'rollCode', 'receivedLotNumber', 'fabricName']), query);
  let results = page.results;
  const unallocated = query.qcStatus === 'passed' && query.status === 'received';
  if (unallocated) {
    const poIds = [...new Set(results.map((roll) => String(roll.poId)))];
    const orders = poIds.length ? await PurchaseOrder.find({ _id: { $in: poIds } }) : [];
    const passed = passedLotKeys(orders);
    results = results.filter((roll) => passed.has(`${String(roll.poId)}:${roll.receivedLotNumber}`));
  }
  const payload = unallocated ? { ...page, results, totalResults: results.length, totalPages: 1 } : page;
  const barcodes = results.map((roll) => roll.barcode);
  const [receivedDates, locations, issued] = await Promise.all([
    receivedDateByGrn(results),
    query.withLocation === '1' ? latestRollLocations(barcodes) : Promise.resolve(null),
    issuedBarcodeSet(barcodes),
  ]);
  return {
    ...payload,
    results: results.map((roll) => ({
      ...roll.toJSON(),
      receivedDate: receivedDates.get(String(roll.grnId)) || null,
      receivedLocked: issued.has(roll.barcode),
      ...(locations ? { rackCode: locations.get(roll.barcode) || '' } : {}),
    })),
  };
};

/**
 * Latest to-location for each barcode.
 * @param {string[]} barcodes
 */
async function latestRollLocations(barcodes) {
  const map = new Map();
  if (!barcodes.length) return map;
  const rows = await StockMovement.find({ entityType: 'roll', entityId: { $in: barcodes } }).sort({ createdAt: 1 });
  rows.forEach((row) => map.set(row.entityId, row.toLocation || ''));
  return map;
}

/**
 * Keys for received lots that are QC passed, so a later hold cannot leak into unallocated storage.
 * @param {import('mongoose').Document[]} orders
 */
function passedLotKeys(orders) {
  const keys = new Set();
  orders.forEach((order) => {
    (order.receivedLots || []).forEach((lot) => {
      if (lot.qcStatus === 'passed') keys.add(`${String(order._id)}:${lot.lotNumber}`);
    });
  });
  return keys;
}

/**
 * GRN received date for each roll, keyed by receipt id.
 * @param {import('mongoose').Document[]} rolls
 */
async function receivedDateByGrn(rolls) {
  const ids = [...new Set(rolls.map((roll) => String(roll.grnId || '')).filter(Boolean))];
  const dates = new Map();
  if (!ids.length) return dates;
  const receipts = await GoodsReceipt.find({ _id: { $in: ids } }).select('receivedDate');
  receipts.forEach((receipt) => dates.set(String(receipt._id), receipt.receivedDate || null));
  return dates;
}
