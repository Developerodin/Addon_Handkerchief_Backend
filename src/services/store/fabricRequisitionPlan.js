import { needsRequisition } from './fabricRequisitionRules.js';

/**
 * Fields copied from the catalog onto an open requisition.
 * @param {{ name?: string, fabricSortNo?: string, colourName?: string, minQuantity?: number }} catalog
 * @param {number} onHand
 */
export function requisitionSnapshot(catalog, onHand) {
  return {
    fabricName: catalog.name || '',
    fabricSortNo: catalog.fabricSortNo || '',
    colourName: catalog.colourName || '',
    minQty: Number(catalog.minQuantity) || 0,
    onHandMeters: Number(onHand) || 0,
  };
}

/**
 * True when the stored row already has the snapshot the list would write.
 * @param {object} row
 * @param {{ fabricName: string, fabricSortNo: string, colourName: string, minQty: number, onHandMeters: number }} snapshot
 */
function snapshotMatches(row, snapshot) {
  return (
    (row.fabricName || '') === snapshot.fabricName &&
    (row.fabricSortNo || '') === snapshot.fabricSortNo &&
    (row.colourName || '') === snapshot.colourName &&
    (Number(row.minQty) || 0) === snapshot.minQty &&
    (Number(row.onHandMeters) || 0) === snapshot.onHandMeters
  );
}

/**
 * Write plan for one fabric. Matches the old per-row reconcile:
 * drop open rows when stock recovered or a PO still covers the fabric,
 * leave a dismissed hold alone, otherwise insert or update the open row.
 * Unchanged rows produce no writes.
 * @param {object} catalog
 * @param {number} onHand
 * @param {boolean} covered
 * @param {object[]} rows Open and dismissed rows for this fabric (`poSent` false).
 */
export function planFabricSnapshot(catalog, onHand, covered, rows) {
  const open = [];
  const dismissed = [];
  (rows || []).forEach((row) => {
    if (row.dismissed === true) dismissed.push(row);
    else open.push(row);
  });
  const empty = { deleteIds: [], recoverIds: [], update: null, insert: null };
  if (!needsRequisition(catalog.minQuantity, onHand)) {
    return {
      ...empty,
      deleteIds: open.map((row) => row._id),
      recoverIds: dismissed.filter((row) => row.stockRecovered !== true).map((row) => row._id),
    };
  }
  if (covered) {
    return { ...empty, deleteIds: open.map((row) => row._id) };
  }
  if (dismissed.some((row) => row.stockRecovered !== true)) return empty;

  const snapshot = requisitionSnapshot(catalog, onHand);
  if (!open.length) {
    return {
      ...empty,
      insert: {
        fabricCatalogId: catalog._id,
        ...snapshot,
        poSent: false,
        draftForPo: false,
        preferredSupplierName: '',
        dismissed: false,
        stockRecovered: false,
      },
    };
  }
  if (snapshotMatches(open[0], snapshot)) return empty;
  return { ...empty, update: { id: open[0]._id, set: snapshot } };
}
