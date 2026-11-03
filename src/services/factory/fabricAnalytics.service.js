import { FabricRoll, PurchaseOrder, StockMovement } from '../../models/store.model.js';
import FabricCatalog from '../../models/fabricCatalog.model.js';

const STORE_STATUSES = ['stored', 'qc-passed', 'received', 'lot-held'];
const CLOSED_PO = ['Received', 'Completed', 'Rejected'];
const OFF_RACK = new Set(['', 'floor', 'vendor', 'dispatched']);
const SORT_FIELDS = new Set([
  'fabricName',
  'inventoryMeters',
  'inOrderMeters',
  'draftMeters',
  'draftPoCount',
  'unallocatedMeters',
  'onRackMeters',
]);

/**
 * Three-decimal quantity, same rounding as the other store reports.
 * @param {number} value
 */
function round3(value) {
  return Math.round((Number(value) || 0) * 1000) / 1000;
}

/**
 * Metres still on the roll. A missing current balance falls back to received metres.
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
 * Metres still on one stored roll.
 * @param {{ currentQtyMeters?: number | null, qtyMeters?: number | null }} roll
 */
function rollMeters(roll) {
  if (roll.currentQtyMeters == null) return Number(roll.qtyMeters) || 0;
  return Number(roll.currentQtyMeters) || 0;
}

/**
 * Catalog id when set, otherwise a name key so orphan lines stay visible.
 * @param {unknown} fabricId
 * @param {unknown} fabricName
 */
function fabricKey(fabricId, fabricName) {
  const id = String(fabricId || '').trim();
  if (id) return id;
  const name = String(fabricName || '')
    .trim()
    .toLowerCase();
  return name ? `name:${name}` : 'unassigned';
}

/**
 * Aggregation key matching `fabricKey` for a string id and a name path.
 * @param {string} idPath
 * @param {string} namePath
 */
function keyExpr(idPath, namePath) {
  const id = { $trim: { input: { $ifNull: [idPath, ''] } } };
  const name = { $trim: { input: { $ifNull: [namePath, ''] } } };
  return {
    $cond: [
      { $gt: [{ $strLenCP: id }, 0] },
      id,
      {
        $cond: [{ $gt: [{ $strLenCP: name }, 0] }, { $concat: ['name:', { $toLower: name }] }, 'unassigned'],
      },
    ],
  };
}

/**
 * Page bounds. List pages stop at 100.
 * @param {object} query
 */
function pageOf(query) {
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 20));
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  return { page, limit, skip: (page - 1) * limit };
}

/**
 * Zeroed fabric row. Catalog ids stay on the row; name keys do not.
 * @param {string} key
 * @param {string} name
 * @param {string} colour
 * @param {string} sortNo
 */
function blankRow(key, name, colour, sortNo) {
  const named = key.startsWith('name:') || key === 'unassigned';
  return {
    fabricId: named ? '' : key,
    fabricName: String(name || '').trim() || 'Unassigned',
    colourName: String(colour || '').trim(),
    fabricSortNo: String(sortNo || '').trim(),
    onRackMeters: 0,
    qcPassedMeters: 0,
    unallocatedMeters: 0,
    heldMeters: 0,
    inOrderMeters: 0,
    draftMeters: 0,
    draftPoIds: [],
    racks: [],
  };
}

/**
 * Fills a name only when the row does not already have one from the catalog.
 * @param {ReturnType<typeof blankRow>} row
 * @param {string} [name]
 * @param {string} [colour]
 * @param {string} [sortNo]
 */
function withNames(row, name, colour, sortNo) {
  const nextName = String(name || '').trim();
  return {
    ...row,
    fabricName: nextName && row.fabricName === 'Unassigned' ? nextName : row.fabricName,
    colourName: colour && !row.colourName ? String(colour).trim() : row.colourName,
    fabricSortNo: sortNo && !row.fabricSortNo ? String(sortNo).trim() : row.fabricSortNo,
  };
}

/**
 * On-hand metres: stored, QC passed, received, and held.
 * @param {{ onRackMeters: number, qcPassedMeters: number, unallocatedMeters: number, heldMeters: number }} row
 */
function inventoryOf(row) {
  return row.onRackMeters + row.qcPassedMeters + row.unallocatedMeters + row.heldMeters;
}

/**
 * Public row. Draft purchase-order ids stay off the wire.
 * @param {ReturnType<typeof blankRow>} row
 */
function present(row) {
  const racks = [...row.racks].sort((a, b) => a.code.localeCompare(b.code));
  return {
    fabricId: row.fabricId,
    fabricName: row.fabricName,
    colourName: row.colourName,
    fabricSortNo: row.fabricSortNo,
    inventoryMeters: round3(inventoryOf(row)),
    inOrderMeters: round3(row.inOrderMeters),
    draftMeters: round3(row.draftMeters),
    draftPoCount: row.draftPoIds.length,
    unallocatedMeters: round3(row.unallocatedMeters),
    onRackMeters: round3(row.onRackMeters),
    racks: racks.map((rack) => ({ code: rack.code, meters: round3(rack.meters) })),
  };
}

/**
 * Store rolls grouped by fabric. Issued and returned rolls never enter.
 */
function rollBuckets() {
  return FabricRoll.aggregate([
    { $match: { status: { $in: STORE_STATUSES } } },
    {
      $group: {
        _id: keyExpr('$fabricId', '$fabricName'),
        rollName: { $first: '$fabricName' },
        rollColour: { $first: '$colourName' },
        onRackMeters: sumWhen(['stored']),
        qcPassedMeters: sumWhen(['qc-passed']),
        unallocatedMeters: sumWhen(['received']),
        heldMeters: sumWhen(['lot-held']),
      },
    },
  ]).allowDiskUse(true);
}

/**
 * Received metres on the current purchase-order line, across every lot.
 */
function receivedForLine() {
  return {
    $sum: {
      $map: {
        input: { $ifNull: ['$receivedLots', []] },
        as: 'lot',
        in: {
          $sum: {
            $map: {
              input: { $ifNull: ['$$lot.lines', []] },
              as: 'recv',
              in: {
                $cond: [{ $eq: ['$$recv.lineId', '$lines.lineId'] }, { $ifNull: ['$$recv.receivedQuantity', 0] }, 0],
              },
            },
          },
        },
      },
    },
  };
}

/**
 * Open-order still-due and draft-order metres, grouped by fabric.
 * Closed and rejected orders are excluded before the unwind.
 */
function orderBuckets() {
  const fabricId = {
    $convert: { input: '$lines.fabricId', to: 'string', onError: '', onNull: '' },
  };
  return PurchaseOrder.aggregate([
    { $match: { status: { $nin: CLOSED_PO } } },
    { $unwind: '$lines' },
    { $addFields: { receivedQty: receivedForLine(), lineFabricId: fabricId } },
    {
      $addFields: {
        fabricKey: keyExpr('$lineFabricId', '$lines.fabricName'),
        stillDue: { $max: [0, { $subtract: [{ $ifNull: ['$lines.quantity', 0] }, '$receivedQty'] }] },
      },
    },
    {
      $group: {
        _id: '$fabricKey',
        fabricName: { $first: '$lines.fabricName' },
        colourName: { $first: '$lines.colourName' },
        fabricSortNo: { $first: '$lines.fabricSortNo' },
        inOrderMeters: { $sum: { $cond: [{ $eq: ['$status', 'Draft'] }, 0, '$stillDue'] } },
        draftMeters: { $sum: { $cond: [{ $eq: ['$status', 'Draft'] }, { $ifNull: ['$lines.quantity', 0] }, 0] } },
        draftPoIds: { $addToSet: { $cond: [{ $eq: ['$status', 'Draft'] }, { $toString: '$_id' }, null] } },
      },
    },
  ]).allowDiskUse(true);
}

/**
 * Latest location per barcode. Sort matches `{ entityType, entityId, createdAt }`
 * so the lookup can walk that index instead of sorting every movement.
 * @param {string[]} barcodes
 */
export function latestLocationPipeline(barcodes) {
  return [
    { $match: { entityType: 'roll', entityId: { $in: barcodes } } },
    { $sort: { entityId: 1, createdAt: -1 } },
    { $group: { _id: '$entityId', toLocation: { $first: '$toLocation' } } },
  ];
}

/**
 * Rack code to metres for stored rolls. Floor, vendor, and dispatched are not racks.
 * @returns {Promise<Map<string, Map<string, number>>>}
 */
async function rackByFabric() {
  const rolls = await FabricRoll.find({ status: 'stored' })
    .select('barcode fabricId fabricName currentQtyMeters qtyMeters')
    .lean();
  const byFabric = new Map();
  if (!rolls.length) return byFabric;
  const locations = await StockMovement.aggregate(latestLocationPipeline(rolls.map((roll) => roll.barcode))).allowDiskUse(
    true
  );
  const byBarcode = new Map(locations.map((row) => [row._id, row.toLocation || '']));
  rolls.forEach((roll) => {
    const location = byBarcode.get(roll.barcode) || '';
    if (OFF_RACK.has(location)) return;
    const key = fabricKey(roll.fabricId, roll.fabricName);
    if (!byFabric.has(key)) byFabric.set(key, new Map());
    const racks = byFabric.get(key);
    racks.set(location, (racks.get(location) || 0) + rollMeters(roll));
  });
  return byFabric;
}

/**
 * @param {Map<string, ReturnType<typeof blankRow>>} rows
 * @param {string} key
 */
function ensure(rows, key) {
  let row = rows.get(key);
  if (!row) {
    row = blankRow(key, '', '', '');
    rows.set(key, row);
  }
  return row;
}

/**
 * Catalog is the spine. Rolls, orders, and racks add fabrics the catalog does not have.
 * @param {object[]} catalog
 * @param {object[]} rolls
 * @param {object[]} orders
 * @param {Map<string, Map<string, number>>} racks
 */
function mergeRows(catalog, rolls, orders, racks) {
  const rows = new Map();
  catalog.forEach((item) => {
    rows.set(String(item._id), blankRow(String(item._id), item.name, item.colourName, item.fabricSortNo));
  });
  rolls.forEach((bucket) => {
    const row = withNames(ensure(rows, bucket._id), bucket.rollName, bucket.rollColour, '');
    row.onRackMeters = bucket.onRackMeters || 0;
    row.qcPassedMeters = bucket.qcPassedMeters || 0;
    row.unallocatedMeters = bucket.unallocatedMeters || 0;
    row.heldMeters = bucket.heldMeters || 0;
    rows.set(bucket._id, row);
  });
  orders.forEach((bucket) => {
    const row = withNames(ensure(rows, bucket._id), bucket.fabricName, bucket.colourName, bucket.fabricSortNo);
    row.inOrderMeters = bucket.inOrderMeters || 0;
    row.draftMeters = bucket.draftMeters || 0;
    row.draftPoIds = (bucket.draftPoIds || []).filter(Boolean);
    rows.set(bucket._id, row);
  });
  racks.forEach((rackMap, key) => {
    const row = ensure(rows, key);
    row.racks = [...rackMap.entries()].map(([code, meters]) => ({ code, meters }));
  });
  return [...rows.values()];
}

/**
 * Case-insensitive match on fabric name, colour, or sort.
 * @param {ReturnType<typeof blankRow>} row
 * @param {unknown} search
 */
function matches(row, search) {
  const needle = String(search || '')
    .trim()
    .toLowerCase();
  if (!needle) return true;
  return [row.fabricName, row.colourName, row.fabricSortNo].some((value) =>
    String(value || '')
      .toLowerCase()
      .includes(needle)
  );
}

/**
 * Value used for one sort column. Inventory and draft counts are derived.
 * @param {ReturnType<typeof blankRow>} row
 * @param {string} field
 */
function sortValue(row, field) {
  if (field === 'inventoryMeters') return inventoryOf(row);
  if (field === 'draftPoCount') return row.draftPoIds.length;
  return row[field];
}

/**
 * Sort for the filtered set. Name is the tie-break.
 * @param {object} query
 */
function compareRows(query) {
  const field = SORT_FIELDS.has(query.sortBy) ? query.sortBy : 'fabricName';
  const direction = query.sortOrder === 'desc' ? -1 : 1;
  return (left, right) => {
    const presentedLeft = sortValue(left, field);
    const presentedRight = sortValue(right, field);
    if (typeof presentedLeft === 'string' || typeof presentedRight === 'string') {
      const nameOrder = String(presentedLeft).localeCompare(String(presentedRight), undefined, { sensitivity: 'base' });
      if (nameOrder) return nameOrder * direction;
    } else if (presentedLeft !== presentedRight) {
      return presentedLeft < presentedRight ? -direction : direction;
    }
    const byName = String(left.fabricName).localeCompare(String(right.fabricName), undefined, { sensitivity: 'base' });
    if (byName) return byName;
    return String(left.fabricId).localeCompare(String(right.fabricId));
  };
}

/**
 * Totals for the filtered fabrics, not just the current page.
 * Draft purchase orders are counted once even when a draft covers several fabrics.
 * @param {ReturnType<typeof blankRow>[]} rows
 */
function summarize(rows) {
  const draftIds = new Set();
  rows.forEach((row) => row.draftPoIds.forEach((id) => draftIds.add(id)));
  const total = (pick) => round3(rows.reduce((sum, row) => sum + pick(row), 0));
  return {
    fabricCount: rows.length,
    inventoryMeters: total(inventoryOf),
    inOrderMeters: total((row) => row.inOrderMeters),
    draftMeters: total((row) => row.draftMeters),
    draftPoCount: draftIds.size,
    unallocatedMeters: total((row) => row.unallocatedMeters),
    onRackMeters: total((row) => row.onRackMeters),
  };
}

/**
 * Fabric analytics. One row per catalog fabric, plus rolls or orders the catalog does not list.
 * @param {object} [query]
 */
export async function fabricAnalytics(query = {}) {
  const [catalog, rolls, orders, racks] = await Promise.all([
    FabricCatalog.find({}).select('name colourName fabricSortNo').lean(),
    rollBuckets(),
    orderBuckets(),
    rackByFabric(),
  ]);
  const filtered = mergeRows(catalog, rolls, orders, racks).filter((row) => matches(row, query.search));
  filtered.sort(compareRows(query));
  const { page, limit, skip } = pageOf(query);
  return {
    results: filtered.slice(skip, skip + limit).map(present),
    page,
    limit,
    totalPages: Math.ceil(filtered.length / limit) || 0,
    totalResults: filtered.length,
    summary: summarize(filtered),
  };
}
