/**
 * Dev: after embroidery-done, put bundle on Thread cutting → Upcoming (clears thread-cut + iron-after logs).
 * Usage: node scripts/rollback-bundle-for-embroidery-thread.js BD-8008A6BC
 */
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { PieceBundle, ProductionOrderLog } from '../src/models/production.model.js';
import { upcomingEmbroideryThread } from '../src/services/production/embroideryThread.service.js';
import { upcomingIronAfter } from '../src/services/production/ironAfter.service.js';

dotenv.config();

const barcode = String(process.argv[2] || '').trim();
if (!barcode) {
  console.error('Usage: node scripts/rollback-bundle-for-embroidery-thread.js <bundle-barcode>');
  process.exit(1);
}

await mongoose.connect(process.env.MONGODB_URL);
const bundle = await PieceBundle.findOne({ barcode });
if (!bundle) {
  console.error('Bundle not found');
  process.exit(1);
}

bundle.process = 'embroidery';
bundle.route = 'embroidery';
bundle.machineBarcode = '';
bundle.containerBarcode = '';
if (!String(bundle.rackCode || '').trim()) bundle.rackCode = 'ST-F-001-A01';
await bundle.save();

const { deletedCount } = await ProductionOrderLog.deleteMany({
  entityType: 'bundle',
  entityCode: barcode,
  action: {
    $in: ['embroidery-thread-start', 'embroidery-thread-done', 'embroidery-thread-cut-done', 'iron-after-start', 'iron-after-done'],
  },
});

const thread = await upcomingEmbroideryThread();
const iron = await upcomingIronAfter();
console.log(`Rolled back ${barcode} -> process embroidery (rack ${bundle.rackCode})`);
console.log(`Removed ${deletedCount} thread-cut / iron-after log(s)`);
console.log('Thread cut upcoming:', thread.results?.map((r) => r.barcode).join(', ') || '(none)');
console.log('Iron after upcoming:', iron.results?.map((r) => r.barcode).join(', ') || '(none)');
await mongoose.disconnect();