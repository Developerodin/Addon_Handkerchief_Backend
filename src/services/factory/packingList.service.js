import httpStatus from 'http-status';
import ApiError from '../../utils/ApiError.js';
import { FabricLot, PackingList, PurchaseOrder } from '../../models/store.model.js';
import { saveStatus } from '../store.service.js';
import { assertPackingLines } from './cutoffGate.js';

/**
 * Marks the PO in transit. Selected lines must already have an approved cutoff.
 * A packlist with no line ids still requires the whole lot to be approved.
 * @param {object} body
 * @param {object} [_params]
 * @param {object | null} [user]
 */
export async function createPackingList(body, _params, user) {
  const lot = await FabricLot.findById(body.lotId);
  if (!lot) throw new ApiError(httpStatus.NOT_FOUND, 'Lot not found');
  const po = await PurchaseOrder.findById(lot.poId);
  if (!po) throw new ApiError(httpStatus.NOT_FOUND, 'Purchase order not found');
  const allowed = ['Submitted to Vendor', 'In Transit', 'Partially Received'];
  if (!allowed.includes(po.status)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Packing list is only for a submitted or partially received order');
  }
  assertPackingLines(lot, po, body.lineIds);
  const list = await PackingList.create(body);
  if (po.status === 'Submitted to Vendor') await saveStatus(po, 'In Transit', list.packingListCode, user);
  return list;
}

const PACKING_FIELDS = [
  'packingListCode',
  'shipmentDate',
  'expectedDelivery',
  'fabricName',
  'rolls',
  'quantity',
  'weight',
  'boxes',
  'courierName',
  'courierNumber',
  'vehicleNumber',
  'challanNumber',
  'notes',
  'lineIds',
  'files',
];

/**
 * Replaces the editable fields on a packlist the transit drawer already saved.
 * @param {string} listId
 * @param {object} body
 */
export async function updatePackingList(listId, body) {
  const list = await PackingList.findById(listId);
  if (!list) throw new ApiError(httpStatus.NOT_FOUND, 'Packing list not found');
  if (body.lineIds !== undefined) {
    const lot = await FabricLot.findById(list.lotId);
    if (!lot) throw new ApiError(httpStatus.NOT_FOUND, 'Lot not found');
    const po = await PurchaseOrder.findById(lot.poId);
    if (!po) throw new ApiError(httpStatus.NOT_FOUND, 'Purchase order not found');
    assertPackingLines(lot, po, body.lineIds);
  }
  PACKING_FIELDS.forEach((field) => {
    if (body[field] !== undefined) list[field] = body[field];
  });
  await list.save();
  return list;
}
