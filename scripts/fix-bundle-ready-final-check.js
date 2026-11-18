/**
 * Clean bundle state for Final checking (normal route after route split).
 * npx cross-env NODE_ENV=development node scripts/fix-bundle-ready-final-check.js BD-D056E94F
 */
import mongoose from 'mongoose';
import config from '../src/config/config.js';
import StorageRack from '../src/models/storageRack.model.js';
import { PieceBundle, ProductionOrder } from '../src/models/production.model.js';
import { QualityResult } from '../src/models/quality.model.js';

const barcode = process.argv[2] || 'BD-D056E94F';

await mongoose.connect(config.mongoose.url, config.mongoose.options);
const bundle = await PieceBundle.findOne({ barcode });
if (!bundle) {
  console.error('Bundle not found');
  process.exit(1);
}
const order = await ProductionOrder.findById(bundle.orderId).select('orderNumber productionType');
const route = ['normal', 'embroidery', 'sticker'].includes(order?.productionType) ? order.productionType : 'normal';

const fc = await QualityResult.findOne({ bundleId: String(bundle.id), kind: 'final-checking' });
if (fc) {
  await QualityResult.deleteOne({ _id: fc._id });
  console.log('Removed existing final-checking row so bundle can be checked again.');
}

if (!bundle.rackCode) {
  const rack = await StorageRack.findOne({ stockType: 'bundles', status: 'active' }).sort({ code: 1 });
  if (rack) bundle.rackCode = rack.code;
}

const finalQc = await QualityResult.findOne({ bundleId: String(bundle.id), kind: 'final-qc' }).sort({ createdAt: -1 });
const finalGood = finalQc?.goodQty ?? bundle.finalGood ?? bundle.qty;

bundle.closed = true;
bundle.process = 'broken';
bundle.route = route;
bundle.finalGood = finalGood;
bundle.machineBarcode = '';
bundle.containerBarcode = '';
bundle.checkedGood = true;
bundle.floorChecked = true;
await bundle.save();

console.log(`Fixed ${barcode} (${order?.orderNumber || bundle.orderId})`);
console.log(`  process=broken route=${bundle.route} finalGood=${bundle.finalGood} rack=${bundle.rackCode}`);
console.log('Next: Quality → Final checking — scan this barcode, save good+defect, packing rack.');

const { upcomingFinalChecking } = await import('../src/services/production/finalChecking.service.js');
const board = await upcomingFinalChecking();
const listed = board.results.some((r) => r.barcode === barcode);
console.log(`  Listed on final-checking upcoming: ${listed ? 'YES' : 'NO'}`);

await mongoose.disconnect();