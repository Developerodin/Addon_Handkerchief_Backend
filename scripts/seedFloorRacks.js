/**
 * Upserts 4 production racks per floor with clear names and codes.
 *
 *   npm run seed:floor-racks
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import ProductionRack from '../src/models/productionRack.model.js';
import { PRODUCTION_STOCK_TYPES } from '../src/models/productionRack.model.js';

dotenv.config();

const FLOORS = [
  { floor: 'vertical-cut', label: 'Vertical cutting', code: 'VTC', stockType: 'pieces' },
  { floor: 'selvage', label: 'Selvage cutting', code: 'SEL', stockType: 'pieces' },
  { floor: 'half-moon', label: 'Half moon cutting', code: 'HM', stockType: 'pieces' },
  { floor: 'vertical-hem', label: 'Vertical hemming', code: 'VH', stockType: 'pieces' },
  { floor: 'single-piece-cutting', label: 'Single piece cutting', code: 'SPC', stockType: 'pieces' },
  { floor: 'floor-check', label: 'Floor checks', code: 'FLC', stockType: 'bundles' },
  { floor: 'horizontal-hem', label: 'Horizontal hemming', code: 'HH', stockType: 'bundles' },
  { floor: 'thread-cutting', label: 'Thread cutting', code: 'THC', stockType: 'bundles' },
  { floor: 'final-qc', label: 'Final QC', code: 'FQC', stockType: 'bundles' },
  { floor: 'iron', label: 'Ironing', code: 'IRN', stockType: 'bundles' },
  { floor: 'embroidery', label: 'Embroidery', code: 'EMB', stockType: 'bundles' },
  { floor: 'embroidery-thread-cut', label: 'Thread cutting after embroidery', code: 'EMT', stockType: 'bundles' },
  { floor: 'sticker', label: 'Sticker', code: 'STK', stockType: 'bundles' },
  { floor: 'iron-after', label: 'Ironing after route', code: 'IRA', stockType: 'bundles' },
  { floor: 'final-checking', label: 'Final checking', code: 'FCH', stockType: 'packing' },
];

function assertStockType(value) {
  if (!PRODUCTION_STOCK_TYPES.includes(value)) {
    throw new Error(`Invalid stock type: ${value}`);
  }
  return value;
}

function buildFloorRacks() {
  const rows = [];
  for (const stage of FLOORS) {
    assertStockType(stage.stockType);
    for (let n = 1; n <= 4; n += 1) {
      const rackCode = `${stage.code}-RCK-0${n}`;
      rows.push({
        code: rackCode,
        name: `${stage.label} · Rack ${n}`,
        floor: stage.floor,
        zone: `${stage.code}-Z${n}`,
        stockType: stage.stockType,
        capacity: 0,
        barcode: rackCode,
        status: 'active',
      });
    }
  }
  return rows;
}

async function main() {
  const url = process.env.MONGODB_URL;
  if (!url) throw new Error('MONGODB_URL is required');

  await mongoose.connect(url, { useNewUrlParser: true, useUnifiedTopology: true });

  const specs = buildFloorRacks();
  for (const row of specs) {
    await ProductionRack.findOneAndUpdate({ code: row.code }, { $set: row }, { upsert: true, new: true, runValidators: true });
  }

  console.log('\n--- Production floor racks seeded ---');
  console.log(`Floors: ${FLOORS.length} · ${specs.length} racks (4 per floor)`);
  console.log('Naming: "[Floor label] · Rack 1" … "Rack 4"');
  console.log('Codes:    VTC-RCK-01 … (barcode = code)\n');

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await mongoose.disconnect();
  } catch {
    // ignore
  }
  process.exit(1);
});