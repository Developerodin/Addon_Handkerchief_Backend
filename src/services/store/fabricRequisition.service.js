import httpStatus from 'http-status';
import mongoose from 'mongoose';
import ApiError from '../../utils/ApiError.js';
import FabricCatalog from '../../models/fabricCatalog.model.js';
import FabricRequisition from '../../models/fabricRequisition.model.js';
import FabricSupplier from '../../models/fabricSupplier.model.js';
import { PurchaseOrder } from '../../models/store.model.js';
import { pageOf } from '../factoryLists.service.js';
import { onHandByFabric } from './fabricRequisitionStock.js';
import { reconcileActiveFabrics } from './fabricRequisitionReconcile.js';
import {
  createDraftPurchaseOrderForRequisition,
  findLatestDraftPurchaseOrder,
  mergeRequisitionIntoDraftPo,
} from './fabricRequisitionDraft.helper.js';
import {
  coveredFabricIds,
  idOf,
  needsRequisition,
  orderQuantity,
  requisitionIdsOnLines,
  workflowStage,
} from './fabricRequisitionRules.js';

const OPEN_FILTER = { poSent: false, dismissed: { $ne: true } };

/**
 * @param {string} value
 */
function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * @param {string} id
 * @param {string} label
 */
function assertObjectId(id, label) {
  if (!mongoose.Types.ObjectId.isValid(id)) throw new ApiError(httpStatus.BAD_REQUEST, `${label} is invalid`);
}

/**
 * @param {object} supplier
 * @param {unknown} fabricId
 */
function supplierListsFabric(supplier, fabricId) {
  const wanted = idOf(fabricId);
  return (supplier.fabricDetails || []).some((row) => idOf(row.fabricCatalogId) === wanted);
}

/**
 * Fabric ids already sitting on a draft or an unreceived purchase order.
 * @param {Array<string | import('mongoose').Types.ObjectId>} fabricIds
 */
async function coveringIds(fabricIds) {
  const rows = await FabricRequisition.find({
    fabricCatalogId: { $in: fabricIds },
    dismissed: { $ne: true },
    poSent: true,
  })
    .select('fabricCatalogId linkedPurchaseOrderId poSent dismissed')
    .lean();
  const poIds = [...new Set(rows.map((row) => idOf(row.linkedPurchaseOrderId)).filter(Boolean))];
  const orders = poIds.length
    ? await PurchaseOrder.find({ _id: { $in: poIds } })
        .select('status')
        .lean()
    : [];
  const statusByPoId = new Map(orders.map((order) => [idOf(order._id), order.status]));
  return coveredFabricIds(rows, statusByPoId);
}

/**
 * Writes or removes the single open requisition for one catalog row.
 * @param {object} catalog
 * @param {number} onHand
 * @param {boolean} covered
 */
async function applySnapshot(catalog, onHand, covered) {
  const filter = { fabricCatalogId: catalog._id, ...OPEN_FILTER };
  if (!needsRequisition(catalog.minQuantity, onHand)) {
    await FabricRequisition.deleteMany(filter);
    await FabricRequisition.updateMany(
      { fabricCatalogId: catalog._id, poSent: false, dismissed: true },
      { $set: { stockRecovered: true } }
    );
    return;
  }
  if (covered) {
    await FabricRequisition.deleteMany(filter);
    return;
  }
  const dismissedHold = await FabricRequisition.exists({
    fabricCatalogId: catalog._id,
    poSent: false,
    dismissed: true,
    stockRecovered: { $ne: true },
  });
  if (dismissedHold) return;
  await FabricRequisition.findOneAndUpdate(
    filter,
    {
      $set: {
        fabricName: catalog.name || '',
        fabricSortNo: catalog.fabricSortNo || '',
        colourName: catalog.colourName || '',
        minQty: Number(catalog.minQuantity) || 0,
        onHandMeters: onHand,
      },
      $setOnInsert: { poSent: false, dismissed: false, draftForPo: false },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

/**
 * Reconciles every active fabric. The list calls this so shortages stay current.
 * Changed rows go out as one bulk write; an unchanged catalog does not hit Mongo again.
 */
export async function reconcileAll() {
  await reconcileActiveFabrics();
}

/**
 * Reconciles one fabric after a roll or catalog change.
 * @param {string} fabricId
 */
export async function reconcileFabric(fabricId) {
  if (!mongoose.Types.ObjectId.isValid(String(fabricId))) return null;
  const catalog = await FabricCatalog.findById(fabricId).select('name fabricSortNo colourName minQuantity status').lean();
  if (!catalog || catalog.status === 'inactive') {
    await FabricRequisition.deleteMany({ fabricCatalogId: fabricId, ...OPEN_FILTER });
    return null;
  }
  const [onHand, covered] = await Promise.all([onHandByFabric([catalog._id]), coveringIds([catalog._id])]);
  const key = idOf(catalog._id);
  await applySnapshot(catalog, onHand.get(key) || 0, covered.has(key));
  return null;
}

/**
 * @param {string | undefined} stage
 */
function workflowFilter(stage) {
  if (stage === 'sent_to_draft') {
    return {
      dismissed: { $ne: true },
      linkedPurchaseOrderId: null,
      $or: [{ draftForPo: true }, { attachedDraftPoId: { $ne: null } }],
    };
  }
  if (stage === 'order_placed') return { linkedPurchaseOrderId: { $ne: null } };
  if (stage === 'all') return { dismissed: { $ne: true } };
  return { ...OPEN_FILTER, attachedDraftPoId: null, linkedPurchaseOrderId: null };
}

/**
 * @param {import('mongoose').Document} row
 * @param {object[]} suppliers
 * @param {string} draftPoNumber
 */
function presentRow(row, suppliers, draftPoNumber) {
  const json = row.toJSON();
  const options = suppliers
    .filter((supplier) => supplierListsFabric(supplier, row.fabricCatalogId))
    .map((supplier) => ({ id: idOf(supplier._id), name: supplier.name }));
  const only = options.length === 1 ? options[0] : null;
  const preferredSupplierId = idOf(json.preferredSupplierId) || (only ? only.id : '');
  return {
    ...json,
    fabricCatalogId: idOf(row.fabricCatalogId),
    preferredSupplierId,
    preferredSupplierName: json.preferredSupplierName || (only ? only.name : ''),
    attachedDraftPoId: idOf(row.attachedDraftPoId),
    linkedPurchaseOrderId: idOf(row.linkedPurchaseOrderId),
    suppliers: options,
    workflowStage: workflowStage(row),
    draftPoNumber,
  };
}

/**
 * Paginated requisition list. Refreshes shortages first, then reads one page.
 * @param {object} query
 */
export async function listRequisitions(query) {
  await reconcileAll();
  const filter = workflowFilter(query.workflow);
  const term = String(query.search || '').trim();
  if (term) {
    const regex = new RegExp(escapeRegex(term), 'i');
    const search = [{ fabricName: regex }, { fabricSortNo: regex }, { colourName: regex }, { preferredSupplierName: regex }];
    if (filter.$or) {
      filter.$and = [{ $or: filter.$or }, { $or: search }];
      delete filter.$or;
    } else {
      filter.$or = search;
    }
  }
  const page = await pageOf(FabricRequisition, filter, query);
  const fabricIds = page.results.map((row) => row.fabricCatalogId);
  const draftIds = page.results.map((row) => row.attachedDraftPoId).filter(Boolean);
  const [suppliers, drafts] = await Promise.all([
    FabricSupplier.find({ status: 'active', 'fabricDetails.fabricCatalogId': { $in: fabricIds } })
      .select('name fabricDetails.fabricCatalogId')
      .lean(),
    draftIds.length
      ? PurchaseOrder.find({ _id: { $in: draftIds } })
          .select('number')
          .lean()
      : [],
  ]);
  const draftNumbers = new Map(drafts.map((draft) => [idOf(draft._id), draft.number]));
  return {
    ...page,
    results: page.results.map((row) => presentRow(row, suppliers, draftNumbers.get(idOf(row.attachedDraftPoId)) || '')),
  };
}

/**
 * @param {string} requisitionId
 */
async function loadOpen(requisitionId) {
  assertObjectId(requisitionId, 'Requisition');
  const doc = await FabricRequisition.findById(requisitionId);
  if (!doc || doc.dismissed) throw new ApiError(httpStatus.NOT_FOUND, 'Requisition not found');
  return doc;
}

/**
 * @param {string} supplierId
 * @param {unknown} fabricId
 */
async function loadSupplierForFabric(supplierId, fabricId) {
  assertObjectId(supplierId, 'Supplier');
  const supplier = await FabricSupplier.findById(supplierId);
  if (!supplier || supplier.status === 'inactive') throw new ApiError(httpStatus.BAD_REQUEST, 'Supplier not found');
  if (!supplierListsFabric(supplier, fabricId)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'This supplier does not list the fabric');
  }
  return supplier;
}

/**
 * Stores the supplier the user picked for this open requisition.
 * @param {string} requisitionId
 * @param {{ supplierId?: string }} body
 */
export async function setSupplier(requisitionId, body) {
  const doc = await loadOpen(requisitionId);
  if (doc.poSent || doc.linkedPurchaseOrderId) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Supplier is locked once the requisition is on a purchase order');
  }
  const supplier = await loadSupplierForFabric(body.supplierId, doc.fabricCatalogId);
  doc.set({ preferredSupplierId: supplier._id, preferredSupplierName: supplier.name });
  await doc.save();
  return doc.toJSON();
}

/**
 * Hides an open requisition. A row already on a draft stays until that line is removed.
 * @param {string} requisitionId
 */
export async function dismiss(requisitionId) {
  const doc = await loadOpen(requisitionId);
  if (doc.poSent || doc.attachedDraftPoId) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Remove it from the draft purchase order before dismissing');
  }
  doc.set({ dismissed: true, dismissedAt: new Date() });
  await doc.save();
  return doc.toJSON();
}

/**
 * Marks the requisition as sitting on a draft.
 * @param {import('mongoose').Document} doc
 * @param {import('mongoose').Document} draft
 * @param {number} minQty
 */
async function attachDraft(doc, draft, minQty) {
  doc.set({
    poSent: true,
    draftForPo: false,
    attachedDraftPoId: draft._id,
    minQty,
  });
  await doc.save();
}

/**
 * Creates a draft PO or adds this fabric onto the latest draft for the same supplier.
 * @param {string} requisitionId
 * @param {{ supplierId?: string }} [body]
 */
export async function sendToDraft(requisitionId, body = {}) {
  const doc = await loadOpen(requisitionId);
  if (doc.linkedPurchaseOrderId)
    throw new ApiError(httpStatus.BAD_REQUEST, 'This requisition is already on a purchase order');
  const existingDraft = doc.attachedDraftPoId ? await PurchaseOrder.findById(doc.attachedDraftPoId) : null;
  if (existingDraft && requisitionIdsOnLines(existingDraft.lines).has(idOf(doc._id))) {
    return { purchaseOrder: existingDraft.toJSON(), merged: true, alreadyStaged: true };
  }
  if (!doc.poSent && body.supplierId) {
    const chosen = await loadSupplierForFabric(body.supplierId, doc.fabricCatalogId);
    doc.set({ preferredSupplierId: chosen._id, preferredSupplierName: chosen.name });
  }
  if (!doc.preferredSupplierId) throw new ApiError(httpStatus.BAD_REQUEST, 'Pick a supplier before creating a draft PO');
  const supplier = await loadSupplierForFabric(idOf(doc.preferredSupplierId), doc.fabricCatalogId);
  const catalog = await FabricCatalog.findById(doc.fabricCatalogId);
  if (!catalog) throw new ApiError(httpStatus.BAD_REQUEST, 'Fabric not found');
  const quantity = orderQuantity(catalog.minQuantity);
  if (!(quantity > 0)) throw new ApiError(httpStatus.BAD_REQUEST, 'Catalog min quantity must be greater than 0');

  const draft = await findLatestDraftPurchaseOrder(supplier);
  if (draft) {
    const staged = await mergeRequisitionIntoDraftPo(draft, doc, catalog);
    await attachDraft(doc, draft, quantity);
    return { purchaseOrder: draft.toJSON(), merged: true, alreadyStaged: staged.alreadyStaged };
  }
  const created = await createDraftPurchaseOrderForRequisition(doc, supplier, catalog);
  await attachDraft(doc, created, quantity);
  return { purchaseOrder: created.toJSON(), merged: false, alreadyStaged: false };
}

/**
 * When a draft is submitted, the staged requisitions become orders placed.
 * @param {{ _id: unknown, lines?: object[] }} po
 */
export async function linkRequisitionsForPurchaseOrder(po) {
  const ids = [...requisitionIdsOnLines(po.lines)];
  if (!ids.length) return;
  await FabricRequisition.updateMany(
    { _id: { $in: ids } },
    { $set: { linkedPurchaseOrderId: po._id, poSent: true, draftForPo: false }, $unset: { attachedDraftPoId: 1 } }
  );
}

/**
 * A line removed from an editable PO sends that requisition back to the open list.
 * @param {object[]} previousLines
 * @param {object[]} nextLines
 */
export async function releaseRequisitionsRemovedFromDraft(previousLines, nextLines) {
  const next = requisitionIdsOnLines(nextLines);
  const dropped = [...requisitionIdsOnLines(previousLines)].filter((id) => !next.has(id));
  if (!dropped.length) return;
  await FabricRequisition.updateMany(
    { _id: { $in: dropped } },
    { $set: { poSent: false, draftForPo: false }, $unset: { attachedDraftPoId: 1, linkedPurchaseOrderId: 1 } }
  );
}
