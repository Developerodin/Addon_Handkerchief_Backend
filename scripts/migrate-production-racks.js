/**
 * Moves non-fabric racks from StorageRack → ProductionRack and seeds ST-F-001-A01 / A02.
 *
 *   NODE_ENV=development node --disable-warning=DEP0170 scripts/migrate-production-racks.js
 */
import mongoose from 'mongoose';
import cfg from '../src/config/config.js';
import StorageRack from '../src/models/storageRack.model.js';
import ProductionRack from '../src/models/productionRack.model.js';
import { PRODUCTION_STOCK_TYPES } from '../src/models/productionRack.model.js';

const SEED = [
  { code: 'ST-F-001-A01', name: 'ST-F-001-A01', floor: 'production', zone: 'F-A', stockType: 'bundles' },
  { code: 'ST-F-001-A02', name: 'ST-F-001-A02', floor: 'production', zone: 'F-A', stockType: 'bundles' },
  { code: 'ST-F-001-B01', name: 'ST-F-001-B01', floor: 'production', zone: 'F-B', stockType: 'pieces' },
  { code: 'ST-F-001-C01', name: 'ST-F-001-C01', floor: 'production', zone: 'F-C', stockType: 'packing' },
  { code: 'FLOW-PIECES', name: 'Floor pieces rack', floor: 'production', zone: 'FLOW', stockType: 'pieces' },
  { code: 'FLOW-PACK', name: 'Floor packing rack', floor: 'production', zone: 'FLOW', stockType: 'packing' },
  { code: 'WH-BOX-01', name: 'Warehouse box rack A', floor: 'warehouse', zone: 'WH-A', stockType: 'box' },
  { code: 'WH-BOX-02', name: 'Warehouse box rack B', floor: 'warehouse', zone: 'WH-B', stockType: 'box' },
];

async function main() {
  await mongoose.connect(cfg.mongoose.url, cfg.mongoose.options);
  const toMove = await StorageRack.find({ stockType: { $ne: 'fabric' } }).lean();
  let moved = 0;
  let skipped = 0;
  for (const row of toMove) {
    const stockType = PRODUCTION_STOCK_TYPES.includes(row.stockType) ? row.stockType : 'bundles';
    const exists = await ProductionRack.findOne({ code: row.code });
    if (!exists) {
      await ProductionRack.create({
        code: row.code,
        name: row.name || row.code,
        location: row.location || '',
        floor: row.floor && row.floor !== 'basement' ? row.floor : 'production',
        zone: row.zone || '',
        stockType,
        capacity: row.capacity ?? 0,
        barcode: row.barcode || row.code,
        status: row.status || 'active',
      });
      moved += 1;
    } else {
      skipped += 1;
    }
    await StorageRack.deleteOne({ _id: row._id });
  }
  let seeded = 0;
  for (const rack of SEED) {
    const exists = await ProductionRack.findOne({ code: rack.code });
    if (exists) continue;
    await ProductionRack.create({ ...rack, barcode: rack.code, status: 'active' });
    seeded += 1;
  }
  const fabricLeft = await StorageRack.countDocuments();
  const productionCount = await ProductionRack.countDocuments();
  console.log(`Migrated ${moved} rack(s), skipped ${skipped} duplicate(s), seeded ${seeded}.`);
  console.log(`StorageRack (fabric): ${fabricLeft}, ProductionRack: ${productionCount}`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});