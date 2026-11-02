import { FabricRoll, StockMovement } from '../../models/store.model.js';
import StorageRack from '../../models/storageRack.model.js';

/** Locations that mean the roll is not sitting on a storage rack. */
const OFF_RACK = ['', 'floor', 'vendor', 'dispatched'];

/**
 * Distinct non-empty fabric names, sorted so the board payload stays stable.
 * @param {unknown[]} names
 * @returns {string[]}
 */
function fabricNames(names) {
  const unique = new Set();
  (names || []).forEach((name) => {
    if (typeof name === 'string' && name.length > 0) unique.add(name);
  });
  return [...unique].sort((left, right) => left.localeCompare(right));
}

/**
 * One Mongo pass: latest movement per roll, then a count and fabric names per rack.
 * Rolls whose latest location is empty, floor, vendor, or dispatched are left out.
 * Fabric names are read from the roll document, not copied off the movement.
 * @returns {object[]}
 */
function latestRackSummaryPipeline() {
  return [
    { $match: { entityType: 'roll' } },
    { $project: { entityId: 1, toLocation: 1, createdAt: 1 } },
    { $sort: { entityId: 1, createdAt: -1, _id: -1 } },
    { $group: { _id: '$entityId', toLocation: { $first: '$toLocation' } } },
    { $match: { toLocation: { $nin: [...OFF_RACK, null] } } },
    { $group: { _id: '$toLocation', count: { $sum: 1 }, barcodes: { $push: '$_id' } } },
    {
      $lookup: {
        from: FabricRoll.collection.name,
        let: { barcodes: '$barcodes' },
        pipeline: [{ $match: { $expr: { $in: ['$barcode', '$$barcodes'] } } }, { $project: { _id: 0, fabricName: 1 } }],
        as: 'rolls',
      },
    },
    { $project: { count: 1, fabrics: '$rolls.fabricName' } },
  ];
}

/**
 * Roll count and fabric names keyed by the rack code the roll last moved to.
 * @returns {Promise<Map<string, { count: number, fabrics: string[] }>>}
 */
async function rollSummaryByRack() {
  const rows = await StockMovement.aggregate(latestRackSummaryPipeline()).allowDiskUse(true);
  const byRack = new Map();
  rows.forEach((row) => {
    byRack.set(row._id, { count: row.count || 0, fabrics: fabricNames(row.fabrics) });
  });
  return byRack;
}

/**
 * Active racks with a derived roll count. occupancy is empty or occupied.
 * The response is every active rack, not a page: the board filters client-side.
 * Floor codes are not rewritten here; that stays on the add-racks write path.
 * @param {object} [query]
 */
export async function rackBoard(query = {}) {
  const [racks, summary] = await Promise.all([
    StorageRack.find({ status: 'active' }).select('code name barcode location floor zone status').sort({ code: 1 }).lean(),
    rollSummaryByRack(),
  ]);
  let results = racks.map((rack) => {
    const placed = summary.get(rack.code) || { count: 0, fabrics: [] };
    return {
      code: rack.code,
      name: rack.name,
      barcode: rack.barcode || rack.code,
      location: rack.location || '',
      floor: rack.floor || '',
      zone: rack.zone || '',
      status: rack.status || 'active',
      count: placed.count,
      fabrics: placed.fabrics,
    };
  });
  if (query.occupancy === 'empty') results = results.filter((row) => row.count === 0);
  if (query.occupancy === 'occupied') results = results.filter((row) => row.count > 0);
  return { results, totalResults: results.length };
}
