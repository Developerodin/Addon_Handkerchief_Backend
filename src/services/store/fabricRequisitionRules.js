/** Rolls that count as usable warehouse stock. */
export const ON_HAND_STATUSES = ['stored', 'qc-passed'];

/** A purchase order in one of these statuses still covers the shortage. */
const OPEN_PO_STATUSES = new Set(['Draft', 'Submitted to Vendor', 'In Transit', 'Partially Received']);

/**
 * Metres on one roll. A missing current balance falls back to the received metres. Zero is a real balance.
 * @param {{ currentQtyMeters?: number | null, qtyMeters?: number | null }} roll
 */
export function rollMeters(roll) {
  if (roll.currentQtyMeters != null) return Math.max(0, Number(roll.currentQtyMeters) || 0);
  return Math.max(0, Number(roll.qtyMeters) || 0);
}

/**
 * Sum of on-hand metres. Issued, on-floor, received, held, and returned rolls contribute nothing.
 * @param {Array<{ status?: string, currentQtyMeters?: number | null, qtyMeters?: number | null }>} rolls
 */
export function onHandMeters(rolls) {
  return (rolls || []).reduce((sum, roll) => {
    if (!ON_HAND_STATUSES.includes(roll.status)) return sum;
    return sum + rollMeters(roll);
  }, 0);
}

/**
 * True when this fabric should have an open requisition. Min quantity of 0 never raises one.
 * @param {number} minQuantity
 * @param {number} onHand
 */
export function needsRequisition(minQuantity, onHand) {
  const min = Number(minQuantity) || 0;
  if (!(min > 0)) return false;
  return Number(onHand) <= min;
}

/**
 * Draft PO line quantity. The full catalog minimum is ordered, not the shortage.
 * @param {number} minQuantity
 */
export function orderQuantity(minQuantity) {
  const qty = Number(minQuantity);
  if (!Number.isFinite(qty) || qty <= 0) return 0;
  return qty;
}

/**
 * Catalog GST is stored as text. Non-numeric values become 0.
 * @param {unknown} value
 */
export function gstPercentOf(value) {
  const parsed = parseFloat(String(value == null ? '' : value).replace(/[^\d.]/g, ''));
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.min(100, parsed);
}

/**
 * @param {unknown} value
 */
export function idOf(value) {
  if (value == null || value === '') return '';
  if (typeof value === 'object' && value._id) return String(value._id);
  return String(value);
}

/**
 * Every requisition id written on purchase-order lines.
 * @param {Array<{ sourceRequisitionId?: unknown, stagedFromRequisitions?: Array<{ requisitionId?: unknown }> }>} lines
 */
export function requisitionIdsOnLines(lines) {
  const ids = new Set();
  (lines || []).forEach((line) => {
    const source = idOf(line.sourceRequisitionId);
    if (source) ids.add(source);
    (line.stagedFromRequisitions || []).forEach((row) => {
      const staged = idOf(row.requisitionId);
      if (staged) ids.add(staged);
    });
  });
  return ids;
}

/**
 * Adds one requisition onto draft lines. The same requisition is not added twice.
 * A different requisition for a fabric already on the draft adds another full minimum.
 * @param {object[]} lines
 * @param {{ _id?: unknown, id?: unknown }} requisition
 * @param {object} builtLine
 */
export function stageRequisitionOnLines(lines, requisition, builtLine) {
  const requisitionId = idOf(requisition._id || requisition.id);
  const current = lines || [];
  if (requisitionIdsOnLines(current).has(requisitionId)) {
    return { lines: current, merged: true, alreadyStaged: true, appended: false };
  }
  const fabricId = idOf(builtLine.fabricId);
  const index = current.findIndex((line) => idOf(line.fabricId) === fabricId);
  if (index < 0) {
    return { lines: [...current, builtLine], merged: false, alreadyStaged: false, appended: true };
  }
  const next = current.map((line, lineIndex) => {
    if (lineIndex !== index) return line;
    const staged = Array.isArray(line.stagedFromRequisitions) ? [...line.stagedFromRequisitions] : [];
    if (staged.length === 0 && line.sourceRequisitionId) {
      staged.push({ requisitionId: line.sourceRequisitionId, quantity: Number(line.quantity) || 0 });
    }
    staged.push({ requisitionId: requisition._id || requisition.id, quantity: builtLine.quantity });
    return {
      ...line,
      quantity: (Number(line.quantity) || 0) + Number(builtLine.quantity || 0),
      stagedFromRequisitions: staged,
    };
  });
  return { lines: next, merged: true, alreadyStaged: false, appended: false };
}

/**
 * Client workflow for one requisition row.
 * @param {{ dismissed?: boolean, linkedPurchaseOrderId?: unknown, attachedDraftPoId?: unknown, draftForPo?: boolean }} row
 */
export function workflowStage(row) {
  if (row.dismissed) return 'dismissed';
  if (idOf(row.linkedPurchaseOrderId)) return 'order_placed';
  if (row.draftForPo || idOf(row.attachedDraftPoId)) return 'sent_to_draft';
  return 'in_requisition';
}

/**
 * A sent requisition still covers the fabric while its PO has not been received or closed.
 * @param {string | undefined} status
 */
export function purchaseStillCovers(status) {
  return OPEN_PO_STATUSES.has(status);
}

/**
 * Fabric ids that should not grow a second open requisition.
 * @param {Array<{ fabricCatalogId?: unknown, dismissed?: boolean, poSent?: boolean, linkedPurchaseOrderId?: unknown }>} rows
 * @param {Map<string, string>} statusByPoId
 */
export function coveredFabricIds(rows, statusByPoId) {
  const covered = new Set();
  (rows || []).forEach((row) => {
    if (row.dismissed || !row.poSent) return;
    const poId = idOf(row.linkedPurchaseOrderId);
    if (!poId || purchaseStillCovers(statusByPoId.get(poId))) covered.add(idOf(row.fabricCatalogId));
  });
  return covered;
}
