import httpStatus from 'http-status';
import ApiError from '../../utils/ApiError.js';
import FabricSupplier from '../../models/fabricSupplier.model.js';
import { FabricRoll, PurchaseOrder, VendorReturn } from '../../models/store.model.js';
import { buildSupplierDetail, mergeSupplierList, nameKey } from './supplierAnalyticsMath.js';

/**
 * Same key the report uses in JavaScript, so a trailing space still matches.
 * @param {string} field
 */
function supplierKeyExpr(field) {
  return {
    $let: {
      vars: { raw: { $trim: { input: { $ifNull: [field, ''] } } } },
      in: { $cond: [{ $eq: ['$$raw', ''] }, 'unknown supplier', { $toLower: '$$raw' }] },
    },
  };
}

/**
 * Purchase-order fields the supplier fold needs. Status history stays in the database.
 */
function orderProject() {
  return {
    $project: {
      supplierName: 1,
      status: 1,
      number: 1,
      purchaseDate: 1,
      lines: {
        $map: {
          input: { $ifNull: ['$lines', []] },
          as: 'line',
          in: {
            lineId: '$$line.lineId',
            fabricName: { $ifNull: ['$$line.fabricName', ''] },
            fabricTypeName: { $ifNull: ['$$line.fabricTypeName', ''] },
            quantity: { $ifNull: ['$$line.quantity', 0] },
          },
        },
      },
      receivedLots: {
        $map: {
          input: { $ifNull: ['$receivedLots', []] },
          as: 'lot',
          in: {
            lines: {
              $map: {
                input: { $ifNull: ['$$lot.lines', []] },
                as: 'line',
                in: {
                  lineId: '$$line.lineId',
                  receivedQuantity: { $ifNull: ['$$line.receivedQuantity', 0] },
                },
              },
            },
          },
        },
      },
    },
  };
}

/**
 * Roll QC grouped by purchase order. The list fold attaches each bucket to its supplier.
 */
function rollQcPipeline() {
  return [
    {
      $group: {
        _id: { poId: '$poId', qcStatus: { $ifNull: ['$qcStatus', 'pending'] } },
        meters: { $sum: { $ifNull: ['$qtyMeters', 0] } },
        rolls: { $sum: 1 },
      },
    },
  ];
}

/**
 * @param {{ _id: { poId?: unknown, qcStatus?: string }, meters?: number, rolls?: number }} row
 */
function normalizeQc(row) {
  return {
    poId: String(row._id.poId),
    qcStatus: row._id.qcStatus || 'pending',
    meters: row.meters,
    rolls: row.rolls,
  };
}

/**
 * Lifetime purchase, fabric, QC, and return totals for every fabric supplier.
 */
export async function suppliersReport() {
  const [orders, qcRows, returnBuckets, catalog] = await Promise.all([
    PurchaseOrder.aggregate([orderProject()]),
    FabricRoll.aggregate(rollQcPipeline()),
    VendorReturn.aggregate([
      {
        $group: {
          _id: supplierKeyExpr('$supplierName'),
          supplierName: { $first: '$supplierName' },
          returns: { $sum: 1 },
          returnQty: { $sum: { $ifNull: ['$quantity', 0] } },
        },
      },
    ]),
    FabricSupplier.find({}).select('name city status contactPerson').lean(),
  ]);
  return mergeSupplierList({
    orders,
    qcRows: qcRows.map(normalizeQc),
    returnBuckets,
    catalog,
  });
}

/**
 * One supplier: fabrics purchased, open and recent orders, QC, and vendor returns.
 * @param {{ name?: string }} query
 */
export async function supplierDetail(query) {
  const name = String((query && query.name) || '').trim();
  if (!name) throw new ApiError(httpStatus.BAD_REQUEST, 'Supplier name is required');
  const key = nameKey(name) || 'unknown supplier';
  const [catalog, orders, returns] = await Promise.all([
    FabricSupplier.find({}).select('name city status contactPerson').lean(),
    PurchaseOrder.aggregate([{ $match: { $expr: { $eq: [supplierKeyExpr('$supplierName'), key] } } }, orderProject()]),
    VendorReturn.aggregate([
      { $match: { $expr: { $eq: [supplierKeyExpr('$supplierName'), key] } } },
      { $project: { reason: 1, quantity: 1, poNumber: 1, issuedAt: 1, supplierName: 1 } },
      { $sort: { issuedAt: -1 } },
    ]),
  ]);
  const ids = orders.map((order) => order._id);
  const qcGrouped = ids.length
    ? await FabricRoll.aggregate([
        { $match: { poId: { $in: ids } } },
        {
          $group: {
            _id: { $ifNull: ['$qcStatus', 'pending'] },
            meters: { $sum: { $ifNull: ['$qtyMeters', 0] } },
            rolls: { $sum: 1 },
          },
        },
      ])
    : [];
  const detail = buildSupplierDetail({
    name,
    catalog,
    orders,
    qcRows: qcGrouped.map((row) => ({ qcStatus: row._id || 'pending', meters: row.meters, rolls: row.rolls })),
    returns,
  });
  if (!detail) throw new ApiError(httpStatus.NOT_FOUND, 'Supplier not found');
  return detail;
}
