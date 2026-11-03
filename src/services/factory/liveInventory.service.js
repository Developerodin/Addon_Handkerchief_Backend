import { FabricRoll } from '../../models/store.model.js';
import FabricCatalog from '../../models/fabricCatalog.model.js';

const LIVE_STATUSES = ['received', 'stored', 'qc-passed', 'lot-held', 'issued', 'on-floor'];
const CSV_CAP = 5000;
const SORT_FIELDS = new Set([
  'fabricName',
  'onRackMeters',
  'qcPassedMeters',
  'unallocatedMeters',
  'rollCount',
  'issuedMeters',
  'availableMeters',
  'status',
]);

const CSV_COLUMNS = [
  ['fabricName', 'Fabric'],
  ['colourName', 'Colour'],
  ['fabricSortNo', 'Sort'],
  ['onRackMeters', 'On rack m'],
  ['qcPassedMeters', 'QC passed m'],
  ['unallocatedMeters', 'Unallocated m'],
  ['rollCount', 'Rolls'],
  ['issuedMeters', 'Issued m'],
  ['heldMeters', 'Held m'],
  ['availableMeters', 'Available m'],
  ['minQuantity', 'Min m'],
  ['status', 'Status'],
];

/**
 * Three-decimal quantity, same rounding as the other store reports.
 * @param {number} value
 */
function round3(value) {
  return Math.round((Number(value) || 0) * 1000) / 1000;
}

/**
 * Metres still on the roll. A missing current balance falls back to received metres.
 * Mirrors on-hand stock so this report and requisitions agree.
 */
function metersExpr() {
  return {
    $cond: [
      { $in: [{ $type: '$currentQtyMeters' }, ['missing', 'null']] },
      { $ifNull: ['$qtyMeters', 0] },
      { $ifNull: ['$currentQtyMeters', 0] },
    ],
  };
}

/**
 * Sums metres only for the given roll statuses.
 * @param {string[]} statuses
 */
function sumWhen(statuses) {
  return {
    $sum: {
      $cond: [{ $in: ['$status', statuses] }, metersExpr(), 0],
    },
  };
}

/**
 * Catalog name when it is set, otherwise the name printed on the roll.
 * @param {string} catalogPath
 * @param {string} rollPath
 * @param {string} fallback
 */
function preferText(catalogPath, rollPath, fallback) {
  return {
    $let: {
      vars: {
        fromCatalog: { $trim: { input: { $ifNull: [catalogPath, ''] } } },
        fromRoll: { $trim: { input: { $ifNull: [rollPath, ''] } } },
      },
      in: {
        $cond: [
          { $gt: [{ $strLenCP: '$$fromCatalog' }, 0] },
          '$$fromCatalog',
          { $cond: [{ $gt: [{ $strLenCP: '$$fromRoll' }, 0] }, '$$fromRoll', fallback] },
        ],
      },
    },
  };
}

/**
 * Zero summary used when the filter matches no fabric.
 */
function emptySummary() {
  return {
    skuCount: 0,
    lowStockCount: 0,
    onRackMeters: 0,
    qcPassedMeters: 0,
    unallocatedMeters: 0,
    issuedMeters: 0,
    heldMeters: 0,
    availableMeters: 0,
  };
}

/**
 * Turns one grouped document into the API row.
 * @param {object} row
 */
function shapeRow(row) {
  return {
    fabricId: String(row.fabricId || ''),
    fabricName: row.fabricName || 'Unassigned',
    colourName: row.colourName || '',
    fabricSortNo: row.fabricSortNo || '',
    minQuantity: round3(row.minQuantity),
    onRackMeters: round3(row.onRackMeters),
    qcPassedMeters: round3(row.qcPassedMeters),
    unallocatedMeters: round3(row.unallocatedMeters),
    rollCount: Number(row.rollCount) || 0,
    issuedMeters: round3(row.issuedMeters),
    heldMeters: round3(row.heldMeters),
    availableMeters: round3(row.availableMeters),
    status: row.status || 'Out of Stock',
  };
}

/**
 * Rounds the facet totals. Issued metres stay out of available.
 * @param {object | undefined} totals
 */
function shapeSummary(totals) {
  const source = totals || emptySummary();
  return {
    skuCount: Number(source.skuCount) || 0,
    lowStockCount: Number(source.lowStockCount) || 0,
    onRackMeters: round3(source.onRackMeters),
    qcPassedMeters: round3(source.qcPassedMeters),
    unallocatedMeters: round3(source.unallocatedMeters),
    issuedMeters: round3(source.issuedMeters),
    heldMeters: round3(source.heldMeters),
    availableMeters: round3(source.availableMeters),
  };
}

/**
 * Page bounds. List pages stop at 100; the drawer stops at 50.
 * @param {object} query
 * @param {number} max
 * @param {number} fallback
 */
function pageOf(query, max, fallback) {
  const limit = Math.min(max, Math.max(1, parseInt(query.limit, 10) || fallback));
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  return { page, limit, skip: (page - 1) * limit };
}

/**
 * Stable sort. Unknown fields fall back to fabric name.
 * @param {object} query
 */
function sortSpec(query) {
  const field = SORT_FIELDS.has(query.sortBy) ? query.sortBy : 'fabricName';
  const direction = query.sortOrder === 'desc' ? -1 : 1;
  return { [field]: direction, fabricId: 1 };
}

/**
 * Escapes a search term so it is matched literally.
 * @param {string} value
 */
function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Search and status run after the catalog lookup, on the grouped rows.
 * @param {object} query
 */
function filterStages(query) {
  const match = {};
  const status = String(query.status || 'all');
  if (status !== 'all') match.status = status;
  const term = String(query.search || '').trim();
  if (term) {
    const regex = escapeRegex(term);
    match.$or = [
      { fabricName: { $regex: regex, $options: 'i' } },
      { colourName: { $regex: regex, $options: 'i' } },
      { fabricSortNo: { $regex: regex, $options: 'i' } },
    ];
  }
  return Object.keys(match).length ? [{ $match: match }] : [];
}

/**
 * One scan of live rolls, grouped by fabric, then joined to the catalog.
 * Returned and vendor-returned rolls never enter the match.
 * @param {object} query
 */
function groupedStages(query) {
  return [
    { $match: { status: { $in: LIVE_STATUSES } } },
    {
      $group: {
        _id: { $ifNull: ['$fabricId', ''] },
        rollName: { $first: '$fabricName' },
        rollColour: { $first: '$colourName' },
        onRackMeters: sumWhen(['stored']),
        qcPassedMeters: sumWhen(['qc-passed']),
        unallocatedMeters: sumWhen(['received']),
        issuedMeters: sumWhen(['issued', 'on-floor']),
        heldMeters: sumWhen(['lot-held']),
        rollCount: { $sum: { $cond: [{ $in: ['$status', ['stored', 'qc-passed']] }, 1, 0] } },
      },
    },
    {
      $lookup: {
        from: FabricCatalog.collection.collectionName,
        let: { fabricKey: '$_id' },
        pipeline: [
          {
            $match: {
              $expr: {
                $eq: [
                  '$_id',
                  { $convert: { input: '$$fabricKey', to: 'objectId', onError: null, onNull: null } },
                ],
              },
            },
          },
          { $project: { name: 1, colourName: 1, fabricSortNo: 1, minQuantity: 1 } },
        ],
        as: 'catalog',
      },
    },
    { $addFields: { catalog: { $arrayElemAt: ['$catalog', 0] } } },
    {
      $addFields: {
        fabricId: '$_id',
        fabricName: preferText('$catalog.name', '$rollName', 'Unassigned'),
        colourName: preferText('$catalog.colourName', '$rollColour', ''),
        fabricSortNo: { $trim: { input: { $ifNull: ['$catalog.fabricSortNo', ''] } } },
        minQuantity: { $ifNull: ['$catalog.minQuantity', 0] },
        availableMeters: { $add: ['$onRackMeters', '$qcPassedMeters'] },
      },
    },
    {
      $addFields: {
        status: {
          $switch: {
            branches: [
              { case: { $lte: ['$availableMeters', 0] }, then: 'Out of Stock' },
              {
                case: {
                  $and: [{ $gt: ['$minQuantity', 0] }, { $lt: ['$availableMeters', '$minQuantity'] }],
                },
                then: 'Low Stock',
              },
            ],
            default: 'In Stock',
          },
        },
      },
    },
    ...filterStages(query),
  ];
}

/**
 * Runs the grouped pipeline once. Summary and the page share that set.
 * @param {object} query
 */
async function aggregateLive(query) {
  const { page, limit, skip } = pageOf(query, 100, 20);
  const [bucket] = await FabricRoll.aggregate([
    ...groupedStages(query),
    {
      $facet: {
        page: [{ $sort: sortSpec(query) }, { $skip: skip }, { $limit: limit }],
        totals: [
          {
            $group: {
              _id: null,
              skuCount: { $sum: 1 },
              lowStockCount: { $sum: { $cond: [{ $eq: ['$status', 'Low Stock'] }, 1, 0] } },
              onRackMeters: { $sum: '$onRackMeters' },
              qcPassedMeters: { $sum: '$qcPassedMeters' },
              unallocatedMeters: { $sum: '$unallocatedMeters' },
              issuedMeters: { $sum: '$issuedMeters' },
              heldMeters: { $sum: '$heldMeters' },
              availableMeters: { $sum: '$availableMeters' },
            },
          },
        ],
      },
    },
  ]).allowDiskUse(true);

  const rows = (bucket?.page || []).map(shapeRow);
  const summary = shapeSummary(bucket?.totals?.[0]);
  return {
    results: rows,
    page,
    limit,
    totalPages: Math.ceil(summary.skuCount / limit),
    totalResults: summary.skuCount,
    summary,
  };
}

/**
 * Live fabric inventory. One row per fabric, paged in the database.
 * @param {object} query
 */
export async function liveInventory(query = {}) {
  return aggregateLive(query);
}

/**
 * Quotes one CSV cell.
 * @param {unknown} value
 */
function csvCell(value) {
  let text = value == null ? '' : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

/**
 * Filtered inventory as CSV. One aggregation, capped at 5000 fabrics.
 * @param {object} query
 */
export async function liveInventoryCsv(query = {}) {
  const rows = await FabricRoll.aggregate([
    ...groupedStages(query),
    { $sort: sortSpec(query) },
    { $limit: CSV_CAP },
  ]).allowDiskUse(true);
  const header = CSV_COLUMNS.map(([, label]) => csvCell(label)).join(',');
  const lines = rows.map((row) => {
    const shaped = shapeRow(row);
    return CSV_COLUMNS.map(([key]) => csvCell(shaped[key])).join(',');
  });
  return `\uFEFF${[header, ...lines].join('\n')}`;
}

/**
 * Metres on one received roll, with the same null fallback as the report.
 * @param {{ currentQtyMeters?: number | null, qtyMeters?: number | null }} roll
 */
function rollMeters(roll) {
  if (roll.currentQtyMeters == null) return round3(roll.qtyMeters);
  return round3(roll.currentQtyMeters);
}

/**
 * Net kilograms still on one received roll.
 * @param {{ currentNetWeight?: number | null, netWeight?: number | null }} roll
 */
function rollNetKg(roll) {
  if (roll.currentNetWeight == null) return round3(roll.netWeight);
  return round3(roll.currentNetWeight);
}

/**
 * Received rolls for one fabric. These are inward rolls that are not on a rack yet.
 * @param {object} query
 */
export async function unallocatedRolls(query = {}) {
  const fabricId = String(query.fabricId || '').trim();
  const { page, limit, skip } = pageOf(query, 50, 50);
  const filter = { fabricId, status: 'received' };
  const [totalResults, rolls] = await Promise.all([
    FabricRoll.countDocuments(filter),
    FabricRoll.find(filter)
      .select('barcode receivedLotNumber poId currentQtyMeters qtyMeters currentNetWeight netWeight')
      .sort({ barcode: 1 })
      .skip(skip)
      .limit(limit)
      .populate({ path: 'poId', select: 'number' })
      .lean(),
  ]);

  return {
    results: rolls.map((roll) => ({
      id: String(roll._id),
      barcode: roll.barcode || '',
      lot: roll.receivedLotNumber || '',
      poNumber: roll.poId && typeof roll.poId === 'object' ? roll.poId.number || '' : '',
      meters: rollMeters(roll),
      netKg: rollNetKg(roll),
    })),
    page,
    limit,
    totalPages: Math.ceil(totalResults / limit),
    totalResults,
  };
}
