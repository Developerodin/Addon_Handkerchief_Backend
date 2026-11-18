/**
 * One-off: bundles that already have a bundle-check but checkedGood was false (M2/M4 split).
 * Run: cross-env NODE_ENV=development node scripts/backfill-floor-checked-bundles.js
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { QualityResult } from '../src/models/quality.model.js';
import { PieceBundle } from '../src/models/production.model.js';

dotenv.config();

const uri = process.env.MONGODB_URL || process.env.MONGO_URL;
if (!uri) {
  console.error('Set MONGODB_URL in .env');
  process.exit(1);
}

await mongoose.connect(uri);
const ids = await QualityResult.distinct('bundleId', { kind: 'bundle-check' });
let updated = 0;
for (const bundleId of ids) {
  if (!bundleId) continue;
  const bundle = await PieceBundle.findById(bundleId);
  if (!bundle) continue;
  if (!bundle.checkedGood || !bundle.floorChecked) {
    bundle.floorChecked = true;
    bundle.checkedGood = true;
    await bundle.save();
    updated += 1;
    console.log(`Updated ${bundle.barcode || bundleId} qty=${bundle.qty} rack=${bundle.rackCode || '(none)'}`);
  }
}
console.log(`Done. ${updated} bundle(s) marked checkedGood + floorChecked.`);
await mongoose.disconnect();