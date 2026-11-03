import FabricCatalog from '../../models/fabricCatalog.model.js';
import FabricRequisition from '../../models/fabricRequisition.model.js';
import { PurchaseOrder } from '../../models/store.model.js';
import { onHandTotals } from './fabricRequisitionStock.js';
import { coveredFabricIds, idOf } from './fabricRequisitionRules.js';
import { planFabricSnapshot } from './fabricRequisitionPlan.js';

/**
 * Groups poSent-false rows by fabric id.
 * @param {object[]} rows
 */
function rowsByFabric(rows) {
  const grouped = new Map();
  rows.forEach((row) => {
    const key = idOf(row.fabricCatalogId);
    const list = grouped.get(key);
    if (list) list.push(row);
    else grouped.set(key, [row]);
  });
  return grouped;
}

/**
 * One unordered bulk write. Skipped when every fabric is already current.
 * @param {Array<{ deleteIds: unknown[], recoverIds: unknown[], update: { id: unknown, set: object } | null, insert: object | null }>} plans
 */
async function flushPlans(plans) {
  const deleteIds = [];
  const recoverIds = [];
  const updates = [];
  const inserts = [];
  plans.forEach((plan) => {
    deleteIds.push(...plan.deleteIds);
    recoverIds.push(...plan.recoverIds);
    if (plan.update) updates.push(plan.update);
    if (plan.insert) inserts.push(plan.insert);
  });
  const now = new Date();
  const ops = [];
  if (deleteIds.length) ops.push({ deleteMany: { filter: { _id: { $in: deleteIds } } } });
  if (recoverIds.length) {
    ops.push({
      updateMany: {
        filter: { _id: { $in: recoverIds } },
        update: { $set: { stockRecovered: true, updatedAt: now } },
      },
    });
  }
  updates.forEach((update) => {
    ops.push({
      updateOne: {
        filter: { _id: update.id },
        update: { $set: { ...update.set, updatedAt: now } },
      },
    });
  });
  inserts.forEach((doc) => {
    ops.push({ insertOne: { document: { ...doc, createdAt: now, updatedAt: now } } });
  });
  if (!ops.length) return 0;
  try {
    await FabricRequisition.bulkWrite(ops, { ordered: false });
  } catch (error) {
    error.message = `Fabric requisition reconcile failed: ${error.message}`;
    throw error;
  }
  return ops.length;
}

/**
 * Reconciles every active fabric in a handful of reads plus one bulk write of real diffs.
 * @returns {Promise<number>} Bulk operations sent. Zero when nothing changed.
 */
export async function reconcileActiveFabrics() {
  const [catalogs, onHand, sentRows, openRows] = await Promise.all([
    FabricCatalog.find({ status: { $ne: 'inactive' } })
      .select('name fabricSortNo colourName minQuantity')
      .lean(),
    onHandTotals(),
    FabricRequisition.find({ dismissed: { $ne: true }, poSent: true })
      .select('fabricCatalogId linkedPurchaseOrderId poSent dismissed')
      .lean(),
    FabricRequisition.find({ poSent: false })
      .select('fabricCatalogId dismissed stockRecovered fabricName fabricSortNo colourName minQty onHandMeters')
      .lean(),
  ]);
  if (!catalogs.length) return 0;

  const poIds = [...new Set(sentRows.map((row) => idOf(row.linkedPurchaseOrderId)).filter(Boolean))];
  const orders = poIds.length
    ? await PurchaseOrder.find({ _id: { $in: poIds } })
        .select('status')
        .lean()
    : [];
  const covered = coveredFabricIds(sentRows, new Map(orders.map((order) => [idOf(order._id), order.status])));
  const byFabric = rowsByFabric(openRows);
  const plans = catalogs.map((catalog) => {
    const key = idOf(catalog._id);
    return planFabricSnapshot(catalog, onHand.get(key) || 0, covered.has(key), byFabric.get(key) || []);
  });
  return flushPlans(plans);
}
