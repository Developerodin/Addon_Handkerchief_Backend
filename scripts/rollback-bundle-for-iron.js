/**
 * Dev: put a bundle back on Ironing → Upcoming after final QC (clears iron/route logs).
 * Usage: node scripts/rollback-bundle-for-iron.js BD-8008A6BC
 */
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { PieceBundle, ProductionOrderLog } from '../src/models/production.model.js';
import { upcomingIron } from '../src/services/production/iron.service.js';

dotenv.config();

const barcode = String(process.argv[2] || '').trim();
if (!barcode) {
  console.error('Usage: node scripts/rollback-bundle-for-iron.js <bundle-barcode>');
  process.exit(1);
}

await mongoose.connect(process.env.MONGODB_URL);
const bundle = await PieceBundle.findOne({ barcode });
if (!bundle) {
  console.error('Bundle not found:', barcode);
  process.exit(1);
}
if (!(bundle.finalGood > 0)) {
  console.error('Bundle has no finalGood — run Final QC first.');
  process.exit(1);
}

bundle.process = 'final-qc';
bundle.route = '';
bundle.machineBarcode = '';
bundle.containerBarcode = '';
if (!String(bundle.rackCode || '').trim()) bundle.rackCode = 'ST-F-001-A01';
await bundle.save();

const { deletedCount } = await ProductionOrderLog.deleteMany({
  entityType: 'bundle',
  entityCode: barcode,
  action: { $in: ['iron-start', 'iron-done', 'bundle-break'] },
});

const board = await upcomingIron();
console.log(`Rolled back ${barcode} (finalGood ${bundle.finalGood}, rack ${bundle.rackCode})`);
console.log(`Removed ${deletedCount} iron/route log(s)`);
console.log('Iron upcoming:', board.results?.map((r) => r.barcode).join(', ') || '(none)');
await mongoose.disconnect();