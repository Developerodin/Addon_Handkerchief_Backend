import { DispatchShipment } from '../../models/warehouse.model.js';

/**
 * Next unused DSP-000001 style code.
 * @returns {Promise<string>}
 */
export const allocateDispatchShipmentCode = async () => {
  const latest = await DispatchShipment.findOne({ shipmentCode: /^DSP-\d{6}$/ })
    .sort({ shipmentCode: -1 })
    .select('shipmentCode')
    .lean();
  let next = latest ? Number(String(latest.shipmentCode).slice(4)) : 0;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    next += 1;
    const shipmentCode = `DSP-${String(next).padStart(6, '0')}`;
    const taken = await DispatchShipment.exists({ shipmentCode });
    if (!taken) return shipmentCode;
  }
  return `DSP-${String(Date.now()).slice(-6)}`;
};