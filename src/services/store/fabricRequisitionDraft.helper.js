import FabricMeasurement from '../../models/fabricMeasurement.model.js';
import { PurchaseOrder } from '../../models/store.model.js';
import { createPurchaseOrder } from '../store.service.js';
import { nextCode } from '../factory/ids.js';
import { gstPercentOf, orderQuantity, stageRequisitionOnLines } from './fabricRequisitionRules.js';

/**
 * Meter from the measurement master, matching the purchase-order form.
 * @param {{ name?: string, symbol?: string }} row
 * @param {string} word
 */
function namesMeter(row, word) {
  const name = String(row.name || '')
    .trim()
    .toLowerCase();
  const symbol = String(row.symbol || '')
    .trim()
    .toLowerCase();
  return name === word || symbol === word;
}

/**
 * Default PO unit. Falls back to the label Meter when the master has no metre row.
 */
async function meterUnit() {
  const rows = await FabricMeasurement.find({ status: 'active', category: 'length' }).lean();
  const meter = rows.find((row) => namesMeter(row, 'meter') || namesMeter(row, 'metre') || namesMeter(row, 'm'));
  if (!meter) return { unitName: 'Meter' };
  const name = String(meter.name || '').trim();
  const symbol = String(meter.symbol || '').trim();
  const unitName = symbol && symbol.toLowerCase() !== name.toLowerCase() ? `${name} (${symbol})` : name || 'Meter';
  return { unitId: meter._id, unitName };
}

/**
 * One purchase-order line for the full catalog minimum.
 * @param {object} catalog
 * @param {object} requisition
 * @param {number} quantity
 * @param {{ unitId?: unknown, unitName: string }} unit
 */
function lineFromCatalog(catalog, requisition, quantity, unit) {
  return {
    lineId: nextCode('LN'),
    fabricId: catalog._id,
    fabricName: catalog.name || requisition.fabricName || '',
    fabricTypeName: catalog.fabricTypeName || '',
    colourName: catalog.colourName || requisition.colourName || '',
    fabricSortNo: catalog.fabricSortNo || requisition.fabricSortNo || '',
    millOldFabricSortNo: catalog.millOldFabricSortNo || '',
    millNewFabricSortNo: catalog.millNewFabricSortNo || '',
    countName: catalog.countName || '',
    quantity,
    ...(unit.unitId ? { unitId: unit.unitId } : {}),
    unitName: unit.unitName,
    rate: Number(catalog.rate) || 0,
    gstPercent: gstPercentOf(catalog.gst),
    sentToSupplier: true,
    sourceRequisitionId: requisition._id,
    stagedFromRequisitions: [{ requisitionId: requisition._id, quantity }],
  };
}

/**
 * Newest draft for this supplier. Manual drafts match by name only when they have no supplier id.
 * @param {{ _id: unknown, name?: string }} supplier
 */
export async function findLatestDraftPurchaseOrder(supplier) {
  const name = String(supplier.name || '').trim();
  return PurchaseOrder.findOne({
    status: 'Draft',
    $or: [{ supplierId: supplier._id }, { supplierName: name, supplierId: null }],
  }).sort({ updatedAt: -1 });
}

/**
 * Adds the requisition onto an existing draft. A repeat of the same requisition does not change quantity.
 * @param {import('mongoose').Document} draftPo
 * @param {import('mongoose').Document} requisition
 * @param {object} catalog
 */
export async function mergeRequisitionIntoDraftPo(draftPo, requisition, catalog) {
  const quantity = orderQuantity(catalog.minQuantity);
  const unit = await meterUnit();
  const built = lineFromCatalog(catalog, requisition, quantity, unit);
  const plain = (draftPo.lines || []).map((line) => (typeof line.toObject === 'function' ? line.toObject() : { ...line }));
  const staged = stageRequisitionOnLines(plain, requisition, built);
  if (!staged.alreadyStaged) {
    draftPo.set('lines', staged.lines);
    draftPo.markModified('lines');
  }
  if (!draftPo.supplierId && requisition.preferredSupplierId) {
    draftPo.set('supplierId', requisition.preferredSupplierId);
  }
  if (draftPo.isModified()) await draftPo.save();
  return staged;
}

/**
 * Opens a new draft purchase order with this fabric at the full minimum quantity.
 * @param {import('mongoose').Document} requisition
 * @param {{ _id: unknown, name: string, address?: string, paymentTerms?: string }} supplier
 * @param {object} catalog
 */
export async function createDraftPurchaseOrderForRequisition(requisition, supplier, catalog) {
  const quantity = orderQuantity(catalog.minQuantity);
  const unit = await meterUnit();
  return createPurchaseOrder({
    supplierId: supplier._id,
    supplierName: supplier.name,
    supplierAddress: supplier.address || '',
    supplierTerms: supplier.paymentTerms || '',
    notes: 'Raised from fabric requisition',
    lines: [lineFromCatalog(catalog, requisition, quantity, unit)],
  });
}
