import logger from '../../config/logger.js';

/**
 * Rebuilds the open requisition for one fabric, or for each id in a list.
 * Imported lazily so stock services do not cycle through the purchase-order service.
 * @param {string | string[]} fabricId
 */
export async function noteFabricStockChange(fabricId) {
  const ids = [
    ...new Set((Array.isArray(fabricId) ? fabricId : [fabricId]).map((id) => String(id || '').trim()).filter(Boolean)),
  ];
  if (!ids.length) return;
  try {
    const { reconcileFabric } = await import('./fabricRequisition.service.js');
    await Promise.all(ids.map((id) => reconcileFabric(id)));
  } catch (error) {
    logger.error(`Fabric requisition reconcile failed: ${error.message}`);
    throw error;
  }
}
