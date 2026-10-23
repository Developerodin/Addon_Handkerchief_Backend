import httpStatus from 'http-status';
import ApiError from '../utils/ApiError.js';
import { VersionScope } from '../models/versioning.model.js';
import { publishScope } from './versioning/publish.service.js';
import { enqueueEvent } from './sync/sync.service.js';

const ROLE_LABEL = {
  'sewing-thread': 'Sewing thread',
  'embroidery-thread': 'Embroidery thread',
  packing: 'Packing',
};

/**
 * Normalize an id that may be a string, ObjectId, or populated document.
 * @param {unknown} value
 * @returns {string}
 */
const refId = (value) => {
  if (value == null || value === '') return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
  if (typeof value === 'object') {
    // Prefer a plain 24-char hex string from ObjectId / Buffer-like values (no recursion).
    const asString = typeof value.toString === 'function' ? String(value) : '';
    if (/^[a-fA-F0-9]{24}$/.test(asString)) return asString;
    const nested = value._id != null && value._id !== value ? value._id : value.id != null && value.id !== value ? value.id : null;
    if (nested == null) return '';
    if (typeof nested === 'string' || typeof nested === 'number') return String(nested).trim();
    const nestedString = typeof nested.toString === 'function' ? String(nested) : '';
    return /^[a-fA-F0-9]{24}$/.test(nestedString) ? nestedString : '';
  }
  return '';
};

/**
 * Catch duplicate packaging / fabric lines early and return a message a user can act on.
 * @param {object} product
 */
const assertClearBomLines = (product) => {
  const fabricLineIds = new Set();
  for (const row of product.bom || []) {
    const lineId = row.bomLineId ? String(row.bomLineId).trim() : '';
    if (!lineId) continue;
    if (fabricLineIds.has(lineId)) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'The fabric BOM has the same line listed more than once. Remove the duplicate fabric row and try again.'
      );
    }
    fabricLineIds.add(lineId);
  }

  const packKeys = new Set();
  for (const row of product.rawMaterials || []) {
    const id = refId(row.rawMaterialId);
    if (!id) continue;
    const role = row.materialRole || 'packing';
    const key = `${id}:${role}`;
    if (packKeys.has(key)) {
      const roleLabel = ROLE_LABEL[role] || role;
      const materialName = row.rawMaterialName || row.name;
      const what = materialName ? `"${materialName}"` : 'the same packaging material';
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `Packaging BOM has ${what} with role "${roleLabel}" more than once. Use each material + role only once, or change the role on one row (for example Packing vs Sewing thread).`
      );
    }
    packKeys.add(key);
  }
};

/**
 * Turns a saved item into version lines for style + production type.
 * Packaging lines use a stable bomLineId so two rows with the same material/role stay unique.
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
    const id = refId(row.rawMaterialId);
    if (!id) continue;
    const role = row.materialRole || 'packing';
    const packLineId = row.bomLineId ? String(row.bomLineId).trim() : '';
    lines.push({
      lineId: packLineId || `pack:${id}:${role}`,
      quantity: Number(row.quantity) || 0,
      values: { materialRole: role, rawMaterialId: id },
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
  assertClearBomLines(product);
  const firstStyle =
    Array.isArray(product.styleCodes) && product.styleCodes.length ? product.styleCodes[0] : null;
  const styleId = refId(firstStyle) || refId(product.id || product._id);
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
    try {
      await enqueueEvent({
        eventId: `rev-${result.revision.id || result.revision._id}`,
        entityType: 'catalog-revision',
        aggregateId: scopeId,
        operation: 'publish',
        payload: { scopeId, revisionId: String(result.revision.id || result.revision._id) },
      });
    } catch (error) {
      // Product/revision already saved — do not turn a sync outbox blip into a 500 for the client.
      console.error('catalogPublish enqueueEvent failed', scopeId, error?.message || error);
    }
  }
  return { scopeId, ...result };
};
