import { VersionScope } from '../models/versioning.model.js';
import { publishScope } from './versioning/publish.service.js';
import { enqueueEvent } from './sync/sync.service.js';

/**
 * Turns a saved item into version lines for style + production type.
 * @param {object} product
 * @returns {object[]}
 */
export const itemLines = (product) => {
  const lines = [
    {
      lineId: 'definition',
      quantity: 1,
      values: {
        productionType: product.productionType,
        piecesPerCut: product.piecesPerCut || 3,
        vendorName: product.vendorName || '',
      },
    },
  ];
  for (const row of product.bom || []) {
    if (!row.bomLineId) continue;
    lines.push({
      lineId: String(row.bomLineId),
      quantity: Number(row.quantity) || 0,
      values: { fabricName: row.fabricName || '', unitCost: Number(row.unitCost) || 0 },
    });
  }
  for (const row of product.rawMaterials || []) {
    const id = row.rawMaterialId ? String(row.rawMaterialId) : '';
    if (!id) continue;
    lines.push({
      lineId: `pack:${id}:${row.materialRole || 'packing'}`,
      quantity: Number(row.quantity) || 0,
      values: { materialRole: row.materialRole || 'packing' },
    });
  }
  return lines;
};

/**
 * Publishes the item definition and queues one sync event for that revision.
 * An unchanged definition does not create a revision.
 * @param {object} product
 * @param {string} [actorId]
 */
export const publishItemDefinition = async (product, actorId) => {
  const styleId =
    Array.isArray(product.styleCodes) && product.styleCodes.length ? String(product.styleCodes[0]) : String(product.id || product._id);
  const scopeId = `style:${styleId}:route:${product.productionType || 'normal'}`;
  const scope = await VersionScope.findOne({ scopeId });
  const result = await publishScope({
    scopeId,
    expectedLockVersion: scope?.lockVersion || 0,
    lines: itemLines(product),
    reason: 'item save',
    actorId: actorId || null,
    source: 'catalog',
  });
  if (result.published && result.revision) {
    await enqueueEvent({
      eventId: `rev-${result.revision.id || result.revision._id}`,
      entityType: 'catalog-revision',
      aggregateId: scopeId,
      operation: 'publish',
      payload: { scopeId, revisionId: String(result.revision.id || result.revision._id) },
    });
  }
  return { scopeId, ...result };
};
