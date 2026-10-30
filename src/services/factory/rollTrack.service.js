import httpStatus from 'http-status';
import ApiError from '../../utils/ApiError.js';
import { FabricRoll, GoodsReceipt, PurchaseOrder, StockMovement } from '../../models/store.model.js';
import { ProductionOrderLog } from '../../models/production.model.js';
import { ensureCurrentBalance } from './rollBalance.js';

const OFF_RACK = new Set(['', 'floor', 'vendor', 'dispatched']);

const MOVE_TITLES = {
  rack: 'Stored in rack',
  unallocate: 'Unallocated from rack',
  issue: 'Issued',
  return: 'Returned from floor',
  'vendor-return': 'Returned to vendor',
  dispatch: 'Dispatched',
};

/**
 * @param {string} kind
 */
function moveTitle(kind) {
  return MOVE_TITLES[kind] || String(kind || 'Movement').replace(/-/g, ' ');
}

/**
 * One roll, its purchase context, and a newest-first timeline.
 * Scan can be the roll barcode or the roll code.
 * @param {string} code
 */
export async function buildRollTrack(code) {
  const scanned = String(code || '').trim();
  const roll = await FabricRoll.findOne({ $or: [{ barcode: scanned }, { rollCode: scanned }] });
  if (!roll) throw new ApiError(httpStatus.NOT_FOUND, 'Roll not found');
  await ensureCurrentBalance(roll);

  const [po, grn, movements, logs] = await Promise.all([
    PurchaseOrder.findById(roll.poId).select('number supplierName receivedLots'),
    GoodsReceipt.findById(roll.grnId).select('number receivedDate supplierName receiver'),
    StockMovement.find({ entityType: 'roll', entityId: roll.barcode }).sort({ createdAt: 1 }),
    ProductionOrderLog.find({
      entityType: 'roll',
      entityCode: { $in: [roll.barcode, roll.rollCode].filter(Boolean) },
    }).sort({ at: 1 }),
  ]);

  const lot = (po?.receivedLots || []).find((row) => row.lotNumber === roll.receivedLotNumber);
  const latest = movements[movements.length - 1];
  const location = latest?.toLocation || '';
  const stored = Boolean(location) && !OFF_RACK.has(location);
  const timeline = buildTimeline({ roll, po, grn, lot, movements, logs });

  return {
    roll: {
      ...roll.toJSON(),
      poNumber: po?.number || '',
      supplierName: grn?.supplierName || po?.supplierName || '',
      grnNumber: grn?.number || '',
      receivedDate: grn?.receivedDate || null,
      createdAt: roll.createdAt || null,
      qcBy: lot?.qcBy || '',
      qcAt: lot?.qcAt || null,
      qcRemarks: lot?.qcRemarks || '',
    },
    rackCode: stored ? location : '',
    location: location || roll.status || '',
    stored,
    timeline,
    openIssue: openIssueView(roll, movements),
    movements: movements.map((row) => ({
      id: String(row._id),
      kind: row.kind,
      fromLocation: row.fromLocation || '',
      toLocation: row.toLocation || '',
      createdAt: row.createdAt,
    })),
  };
}

/**
 * PO receipt, roll creation, QC, stock moves, and other roll logs.
 * @param {object} source
 */
function buildTimeline(source) {
  const { roll, po, grn, lot, movements, logs } = source;
  const events = [];

  events.push({
    id: `received-${roll.barcode}`,
    at: grn?.receivedDate || roll.createdAt || null,
    title: 'PO received',
    details: {
      'PO number': po?.number || '',
      Supplier: grn?.supplierName || po?.supplierName || '',
      'GRN number': grn?.number || '',
      Receiver: grn?.receiver || '',
    },
  });

  events.push({
    id: `created-${roll.barcode}`,
    at: roll.createdAt || grn?.receivedDate || null,
    title: 'Roll created',
    details: {
      'Roll ID': roll.rollCode || roll.barcode,
      Fabric: roll.fabricName || '',
      Colour: roll.colourName || '',
      'Lot number': roll.receivedLotNumber || '',
      'Gross (kg)': roll.grossWeight ?? '',
      'Net (kg)': roll.netWeight ?? '',
      Meters: roll.qtyMeters ?? '',
    },
  });

  if (roll.qcStatus && roll.qcStatus !== 'pending') {
    events.push({
      id: `qc-${roll.barcode}`,
      at: lot?.qcAt || null,
      title: `QC ${roll.qcStatus}`,
      details: {
        Status: roll.qcStatus,
        'Checked by': lot?.qcBy || '',
        Remarks: lot?.qcRemarks || '',
      },
    });
  }

  movements.forEach((row) => {
    const onRack = row.toLocation && !OFF_RACK.has(row.toLocation);
    events.push({
      id: String(row._id),
      at: row.createdAt,
      title: moveTitle(row.kind),
      details: {
        'Storage location': row.toLocation || '',
        From: row.fromLocation || '',
        'Stored status': onRack ? 'Yes' : 'No',
        ...balanceDetails(row),
      },
    });
  });

  logs.forEach((log) => {
    if (log.action === 'rack') return;
    events.push({
      id: `log-${log.id || log._id}`,
      at: log.at,
      title: moveTitle(log.action),
      details: {
        User: log.userName || '',
        From: log.fromLocation || '',
        To: log.toLocation || '',
        Remarks: log.remarks || '',
      },
    });
  });

  return events
    .map((event) => ({
      ...event,
      details: Object.fromEntries(Object.entries(event.details).filter(([, value]) => value !== '' && value != null)),
    }))
    .sort((left, right) => new Date(right.at || 0).getTime() - new Date(left.at || 0).getTime());
}

/**
 * Gross, net, meters, and user stored on an issue or return movement.
 * @param {object} row
 */
function balanceDetails(row) {
  if (row.kind !== 'issue' && row.kind !== 'return-to-rack') return {};
  return {
    'Gross (kg)': row.grossWeight == null ? '' : row.grossWeight,
    'Net (kg)': row.netWeight == null ? '' : row.netWeight,
    Meters: row.qtyMeters == null ? '' : row.qtyMeters,
    User: row.userName || '',
  };
}

/**
 * The issue that is still out, with weights the return screen can show.
 * @param {object} roll
 * @param {object[]} movements oldest first
 */
function openIssueView(roll, movements) {
  const row = [...movements].reverse().find((item) => item.kind === 'issue' || item.kind === 'return-to-rack');
  if (!row || row.kind !== 'issue') return null;
  const metersKnown = row.qtyMeters != null || Number(roll.qtyMeters) > 0;
  return {
    grossWeight: row.grossWeight == null ? Number(roll.grossWeight) || 0 : Number(row.grossWeight),
    netWeight: Number(row.netWeight) > 0 ? Number(row.netWeight) : Number(roll.netWeight) || 0,
    qtyMeters: row.qtyMeters == null ? Number(roll.qtyMeters) || 0 : Number(row.qtyMeters),
    metersKnown,
  };
}
