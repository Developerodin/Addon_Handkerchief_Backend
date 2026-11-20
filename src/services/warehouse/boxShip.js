import { ClientOrder, DispatchBox } from '../../models/warehouse.model.js';
import { StockMovement } from '../../models/store.model.js';
import { writeOrderLog } from '../orderLog.service.js';
import { syncProductionOrderDispatch } from './orderDispatch.js';

/**
 * Marks one on-rack box as dispatched (shared by batch dispatch).
 * @param {object} opts
 * @param {import('mongoose').Document} opts.box
 * @param {string} opts.vehicle
 * @param {string} opts.eventId
 * @param {string} [opts.shipmentId]
 * @param {object | null} [user]
 */
export const shipOneBox = async ({ box, vehicle, eventId, shipmentId }, user) => {
  const existing = await DispatchBox.findOne({ eventId });
  if (existing) return existing;
  if (box.status !== 'on-rack') {
    throw new Error(`Box ${box.barcode} is not on a rack`);
  }
  const order = box.clientOrderId ? await ClientOrder.findById(box.clientOrderId) : null;
  const fromRack = box.rackCode;
  box.eventId = eventId;
  box.status = 'dispatched';
  box.vehicleNumber = vehicle;
  if (shipmentId) box.dispatchShipmentId = shipmentId;
  box.clientAddress = order?.clientAddress || box.clientAddress || '';
  await box.save();
  await StockMovement.create({
    eventId,
    entityType: 'box',
    entityId: box.barcode,
    kind: 'dispatch',
    fromLocation: fromRack,
    toLocation: 'dispatched',
    quantity: 1,
    orderId: box.productionOrderId,
  });
  await writeOrderLog(
    {
      action: 'dispatch',
      orderId: box.productionOrderId,
      entityType: 'box',
      entityCode: box.barcode,
      fromLocation: fromRack,
      toLocation: 'dispatched',
      remarks: vehicle,
    },
    user
  );
  if (order) {
    const left = await DispatchBox.countDocuments({ clientOrderId: order.id, status: { $ne: 'dispatched' } });
    order.status = left > 0 ? 'partially-dispatched' : 'dispatched';
    await order.save();
  }
  if (box.productionOrderId) {
    await syncProductionOrderDispatch(box.productionOrderId, user);
  }
  return box;
};