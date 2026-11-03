import { FabricRoll } from '../../models/store.model.js';
import { ON_HAND_STATUSES } from './fabricRequisitionRules.js';

export { ON_HAND_STATUSES };

/**
 * Sums stored and QC-passed metres. A null current balance falls back to received metres.
 * @param {object} match
 * @returns {Promise<Map<string, number>>}
 */
async function sumOnHand(match) {
  const rows = await FabricRoll.aggregate([
    { $match: match },
    {
      $group: {
        _id: '$fabricId',
        meters: {
          $sum: {
            $cond: [
              { $in: [{ $type: '$currentQtyMeters' }, ['missing', 'null']] },
              { $ifNull: ['$qtyMeters', 0] },
              { $ifNull: ['$currentQtyMeters', 0] },
            ],
          },
        },
      },
    },
  ]);
  const totals = new Map();
  rows.forEach((row) => {
    totals.set(String(row._id), Number(row.meters) || 0);
  });
  return totals;
}

/**
 * On-hand metres by fabric catalog id. Only stored and QC-passed rolls count.
 * @param {Array<string | import('mongoose').Types.ObjectId>} fabricIds
 * @returns {Promise<Map<string, number>>}
 */
export async function onHandByFabric(fabricIds) {
  const ids = [...new Set((fabricIds || []).map((id) => String(id || '')).filter(Boolean))];
  const totals = new Map(ids.map((id) => [id, 0]));
  if (!ids.length) return totals;
  const summed = await sumOnHand({ status: { $in: ON_HAND_STATUSES }, fabricId: { $in: ids } });
  summed.forEach((meters, id) => totals.set(id, meters));
  return totals;
}

/**
 * On-hand metres for every fabric that currently has stored or QC-passed rolls.
 * Used by the full reconcile so it does not wait on the catalog id list.
 * @returns {Promise<Map<string, number>>}
 */
export async function onHandTotals() {
  return sumOnHand({ status: { $in: ON_HAND_STATUSES } });
}
