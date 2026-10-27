import mongoose from 'mongoose';
import { FabricRoll, PurchaseOrder } from '../../models/store.model.js';
import { itemLines } from '../catalogPublish.service.js';
import { reconstructState } from '../versioning/checkpoint.service.js';

const BASEMENT = new Set(['stored', 'qc-passed', 'received']);

/**
 * Floor route. internal and outsourced are not floor routes.
 * @param {string} productionType
 */
export const routeOf = (productionType) =>
  productionType === 'embroidery' || productionType === 'sticker' ? productionType : 'normal';

/**
 * Same scope id item save publishes.
 * @param {object} product
 */
export const scopeIdFor = (product) => {
  const styleId =
    Array.isArray(product.styleCodes) && product.styleCodes.length
      ? String(product.styleCodes[0]._id || product.styleCodes[0])
      : String(product.id || product._id);
  return `style:${styleId}:route:${product.productionType || 'normal'}`;
};

/**
 * Fabric rows on the item itself. Used when a revision has no fabric lines.
 * @param {object} product
 */
export const fabricLinesFromProduct = (product) =>
  (product?.bom || [])
    .map((row) => ({
      bomLineId: String(row.bomLineId || row._id || ''),
      fabricCatalogId: String(row.fabricCatalogId?._id || row.fabricCatalogId?.id || row.fabricCatalogId || ''),
      fabricName: row.fabricName || row.fabricCatalogId?.name || '',
      metresPerPiece: Number(row.quantity) || 0,
      unitCost: Number(row.unitCost) || 0,
    }))
    .filter((row) => row.bomLineId || row.fabricName);

/**
 * Freezes fabric, thread, packing, pieces per cut, and rates from a revision.
 * @param {object[]} versionLines
 * @param {object} product
 */
export const buildSnapshot = (versionLines, product) => {
  const definition = versionLines.find((line) => line.lineId === 'definition');
  const productBom = new Map((product.bom || []).map((row) => [String(row.bomLineId || ''), row]));
  const fabricBom = [];
  const threadLines = [];
  const packingLines = [];
  for (const line of versionLines) {
    if (line.lineId === 'definition') continue;
    if (String(line.lineId).startsWith('pack:')) {
      const role = line.values?.materialRole || 'packing';
      const row = {
        lineId: line.lineId,
        materialRole: role,
        quantity: Number(line.quantity) || 0,
        rawMaterialId: String(line.lineId).split(':')[1] || '',
      };
      if (role === 'sewing-thread' || role === 'embroidery-thread') threadLines.push(row);
      else packingLines.push(row);
      continue;
    }
    const source = productBom.get(String(line.lineId));
    fabricBom.push({
      bomLineId: String(line.lineId),
      fabricCatalogId: source?.fabricCatalogId ? String(source.fabricCatalogId._id || source.fabricCatalogId) : '',
      fabricName: line.values?.fabricName || source?.fabricName || '',
      metresPerPiece: Number(line.quantity) || 0,
      unitCost: Number(line.values?.unitCost) || Number(source?.unitCost) || 0,
    });
  }
  const pieces = Number(definition?.values?.piecesPerCut) === 4 ? 4 : 3;
  return {
    fabricBom,
    threadLines,
    packingLines,
    piecesPerCut: pieces,
    route: routeOf(definition?.values?.productionType || product.productionType),
    rates: fabricBom.map((row) => ({ bomLineId: row.bomLineId, unitCost: row.unitCost })),
    currency: 'INR',
    calculationPolicy: 'metres-per-piece',
  };
};

/**
 * Revision lines when the id is a real published revision, otherwise the live item.
 * @param {object} product
 * @param {string} revisionId
 */
export const linesForRevision = async (product, revisionId) => {
  const scopeId = scopeIdFor(product);
  if (revisionId && mongoose.Types.ObjectId.isValid(revisionId)) {
    try {
      const state = await reconstructState(scopeId, revisionId);
      return { scopeId, lines: state.lines };
    } catch (error) {
      if (error.statusCode !== 404) throw error;
    }
  }
  return { scopeId, lines: itemLines(product) };
};

/**
 * Basement rolls and purchased metres still in store for one fabric.
 * Metres are the purchase-order quantity scaled by rolls that have not left the basement.
 * @param {object[]} fabricBom
 */
export const fabricAvailability = async (fabricBom) => {
  const rows = [];
  for (const fabric of fabricBom || []) {
    const id = fabric.fabricCatalogId || '';
    const name = fabric.fabricName || '';
    let rolls = [];
    if (id || name) {
      const filter = id ? { $or: [{ fabricId: id }, ...(name ? [{ fabricName: name }] : [])] } : { fabricName: name };
      rolls = await FabricRoll.find(filter).select('status').lean();
    }
    const inStore = rolls.filter((roll) => BASEMENT.has(roll.status));
    let purchased = 0;
    if (id && mongoose.Types.ObjectId.isValid(id)) {
      const orders = await PurchaseOrder.find({ 'lines.fabricId': id }).select('lines.quantity lines.fabricId').lean();
      for (const order of orders) {
        for (const line of order.lines || []) {
          if (String(line.fabricId) === id) purchased += Number(line.quantity) || 0;
        }
      }
    }
    const onHandMetres = rolls.length ? (purchased * inStore.length) / rolls.length : 0;
    rows.push({
      bomLineId: fabric.bomLineId,
      fabricName: name,
      fabricCatalogId: id,
      metresPerPiece: fabric.metresPerPiece,
      onHandRolls: inStore.length,
      onHandMetres: Math.round(onHandMetres * 1000) / 1000,
      inBasement: inStore.length > 0,
    });
  }
  return rows;
};
