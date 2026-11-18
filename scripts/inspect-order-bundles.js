import mongoose from 'mongoose';
import config from '../src/config/config.js';
import { PieceBundle, ProductionOrder } from '../src/models/production.model.js';
import { QualityResult } from '../src/models/quality.model.js';

const orderNumber = process.argv[2] || 'ORD-000003';

await mongoose.connect(config.mongoose.url, config.mongoose.options);
const order = await ProductionOrder.findOne({ orderNumber });
if (!order) {
  console.log(`Order ${orderNumber} not found (db: ${mongoose.connection.name})`);
  await mongoose.disconnect();
  process.exit(1);
}
console.log(`Order ${order.orderNumber} id=${order.id} db=${mongoose.connection.name}`);
const bundles = await PieceBundle.find({ orderId: order.id }).sort({ number: 1 });
for (const b of bundles) {
  const check = await QualityResult.findOne({ bundleId: String(b.id), kind: 'bundle-check' }).sort({ createdAt: -1 });
  const hemReady =
    b.closed && b.checkedGood && b.rackCode && b.barcode && (!b.process || b.process === 'created');
  console.log('---');
  console.log(`#${b.number} ${b.barcode || '(no barcode)'} qty=${b.qty}`);
  console.log(
    `  closed=${b.closed} rackCode=${JSON.stringify(b.rackCode)} checkedGood=${b.checkedGood} floorChecked=${b.floorChecked} process=${b.process || '(empty)'}`
  );
  console.log(`  horizontal hem upcoming: ${hemReady ? 'YES' : 'NO'}`);
  if (!hemReady) {
    const reasons = [];
    if (!b.closed) reasons.push('not closed');
    if (!b.checkedGood) reasons.push('checkedGood false');
    if (!b.rackCode) reasons.push('no rackCode — place on bundles rack in single piece');
    if (!b.barcode) reasons.push('no barcode');
    if (b.process && b.process !== 'created') reasons.push(`process=${b.process}`);
    console.log(`  blockers: ${reasons.join('; ') || 'unknown'}`);
  }
  if (check) {
    const m2 = check.m2Qty ?? check.defectQty;
    console.log(`  last check: good=${check.goodQty} m2=${m2} m4=${check.m4Qty} passed=${check.passed}`);
  } else {
    console.log('  no bundle-check saved yet');
  }
}
await mongoose.disconnect();