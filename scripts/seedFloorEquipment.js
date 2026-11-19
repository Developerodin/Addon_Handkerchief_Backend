/**
 * Upserts 2 machines + 2 tables per production floor with clear names and codes.
 *
 *   npm run seed:floor-equipment
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Machine from '../src/models/machine.model.js';

dotenv.config();

/** Matches Process.floor in production master (same as catalog floor dropdown). */
const FLOORS = [
  { floor: 'vertical-cut', label: 'Vertical cutting', code: 'VTC' },
  { floor: 'selvage', label: 'Selvage cutting', code: 'SEL' },
  { floor: 'half-moon', label: 'Half moon cutting', code: 'HM' },
  { floor: 'vertical-hem', label: 'Vertical hemming', code: 'VH' },
  { floor: 'single-piece-cutting', label: 'Single piece cutting', code: 'SPC' },
  { floor: 'floor-check', label: 'Floor checks', code: 'FLC' },
  { floor: 'horizontal-hem', label: 'Horizontal hemming', code: 'HH' },
  { floor: 'thread-cutting', label: 'Thread cutting', code: 'THC' },
  { floor: 'final-qc', label: 'Final QC', code: 'FQC' },
  { floor: 'iron', label: 'Ironing', code: 'IRN' },
  { floor: 'embroidery', label: 'Embroidery', code: 'EMB' },
  { floor: 'embroidery-thread-cut', label: 'Thread cutting after embroidery', code: 'EMT' },
  { floor: 'sticker', label: 'Sticker', code: 'STK' },
  { floor: 'iron-after', label: 'Ironing after route', code: 'IRA' },
  { floor: 'final-checking', label: 'Final checking', code: 'FCH' },
];

function buildFloorEquipment() {
  const rows = [];
  for (const stage of FLOORS) {
    for (let n = 1; n <= 2; n += 1) {
      const machineCode = `${stage.code}-MCH-0${n}`;
      const tableCode = `${stage.code}-TBL-0${n}`;
      rows.push({
        name: `${stage.label} · Machine ${n}`,
        code: machineCode,
        floor: stage.floor,
        equipmentRole: 'machine',
        barcode: machineCode,
        status: 'active',
      });
      rows.push({
        name: `${stage.label} · Table ${n}`,
        code: tableCode,
        floor: stage.floor,
        equipmentRole: 'table',
        barcode: tableCode,
        status: 'active',
      });
    }
  }
  return rows;
}

async function main() {
  const url = process.argv[2] || process.env.MONGODB_ATLAS_URL || process.env.MONGODB_URL;
  if (!url) throw new Error('MONGODB_URL or MONGODB_ATLAS_URL is required (or pass URL as argv[2])');

  await mongoose.connect(url, { useNewUrlParser: true, useUnifiedTopology: true });

  const specs = buildFloorEquipment();
  let upserted = 0;

  for (const row of specs) {
    await Machine.findOneAndUpdate(
      { code: row.code },
      { $set: row },
      { upsert: true, new: true, runValidators: true },
    );
    upserted += 1;
  }

  console.log('\n--- Floor equipment seeded ---');
  console.log(`Floors: ${FLOORS.length} · ${upserted} machines/tables (${FLOORS.length * 4} expected)`);
  console.log('Naming: "[Floor label] · Machine 1" / "[Floor label] · Table 1"');
  console.log('Codes:   VTC-MCH-01, VTC-TBL-01, … (barcode matches code for scanning)\n');
  FLOORS.slice(0, 3).forEach((stage) => {
    console.log(`  ${stage.label}: ${stage.code}-MCH-01, ${stage.code}-MCH-02, ${stage.code}-TBL-01, ${stage.code}-TBL-02`);
  });
  console.log('  …');

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