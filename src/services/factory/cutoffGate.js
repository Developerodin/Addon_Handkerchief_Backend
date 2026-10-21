import httpStatus from 'http-status';
import ApiError from '../../utils/ApiError.js';

/**
 * Identity shared by a purchase-order line and its lot cutoff.
 * Falls back to the line id when the line has no fabric id.
 * @param {{ fabricId?: unknown, lineId?: unknown } | null | undefined} line
 */
export function cutoffKey(line) {
  return String(line?.fabricId || line?.lineId || '');
}

/**
 * Cutoff keys that are already approved on the lot.
 * @param {{ cutoffs?: Array<{ fabricId: string, approved: boolean }> } | null | undefined} lot
 */
export function approvedCutoffIds(lot) {
  return new Set((lot?.cutoffs || []).filter((row) => row.approved).map((row) => String(row.fabricId)));
}

/**
 * A packing list may name only lines whose cutoff is approved.
 * An empty line list still requires every cutoff on the lot to be approved.
 * @param {{ status: string, cutoffs?: Array<{ fabricId: string, approved: boolean }> }} lot
 * @param {{ lines?: Array<{ lineId: string, fabricId?: unknown }> }} po
 * @param {string[] | undefined} lineIds
 */
export function assertPackingLines(lot, po, lineIds) {
  const ids = Array.isArray(lineIds) ? lineIds.map(String).filter(Boolean) : [];
  if (!ids.length) {
    if (lot.status !== 'approved') {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Packing list needs an approved lot');
    }
    return;
  }
  const approved = approvedCutoffIds(lot);
  ids.forEach((lineId) => {
    const line = (po.lines || []).find((row) => row.lineId === lineId);
    if (!line) throw new ApiError(httpStatus.BAD_REQUEST, 'Packing list line is not on this purchase order');
    if (!approved.has(cutoffKey(line))) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Cutoff is not approved');
    }
  });
}

/**
 * Rejects a receipt that would take in a line whose cutoff is not approved.
 * Rolls that do not name a fabric are allowed only when the whole lot is approved.
 * @param {{ status: string, cutoffs?: Array<{ fabricId: string, approved: boolean }> }} lot
 * @param {Array<{ fabricId?: string }>} rolls
 */
export function assertReceiptCutoffs(lot, rolls) {
  const approved = approvedCutoffIds(lot);
  const rows = rolls || [];
  if (!rows.length) {
    if (lot.status !== 'approved') {
      throw new ApiError(httpStatus.BAD_REQUEST, 'A lot with one rejected cutoff cannot be received');
    }
    return;
  }
  rows.forEach((roll) => {
    if (!roll.fabricId) {
      if (lot.status !== 'approved') {
        throw new ApiError(httpStatus.BAD_REQUEST, 'A lot with one rejected cutoff cannot be received');
      }
      return;
    }
    if (!approved.has(String(roll.fabricId))) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Cutoff is not approved');
    }
  });
}
