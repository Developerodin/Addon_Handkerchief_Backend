import * as dispatchShipment from './dispatchShipment.service.js';

/**
 * E2E / scripts helper: one box through create → scan → dispatch batch.
 * @param {{ boxBarcode: string; productionOrderId: string; vehicleNumber: string; eventId?: string }} opts
 * @param {object | null} [user]
 */
export const shipBoxViaBatch = async (opts, user) => {
  const draft = await dispatchShipment.createOrOpenDraft({ productionOrderId: opts.productionOrderId }, {}, user);
  await dispatchShipment.scanBoxIntoShipment({ boxBarcode: opts.boxBarcode }, { id: draft.id }, user);
  return dispatchShipment.dispatchShipment(
    {
      vehicleNumber: opts.vehicleNumber,
      eventId: opts.eventId || `e2e-${draft.shipmentCode}`,
      site: 'factory',
    },
    { id: draft.id },
    user
  );
};