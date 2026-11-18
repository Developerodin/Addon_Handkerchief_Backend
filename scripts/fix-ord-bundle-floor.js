/**
 * Close + barcode + rack + floor flags for ORD-000003 bundle stuck after manual floor check.
 * npx cross-env NODE_ENV=development node scripts/fix-ord-bundle-floor.js ORD-000003
 */
import mongoose from 'mongoose';
import config from '../src/config/config.js';
import StorageRack from '../src/models/storageRack.model.js';
import { PieceBundle, ProductionOrder } from '../src/models/production.model.js';
import { nextCode } from '../src/services/factory/ids.js';

const orderNumber = process.argv[2] || 'ORD-000003';

await mongoose.connect(config.mongoose.url, config.mongoose.options);
const order = await ProductionOrder.findOne({ orderNumber });
if (!order) {
  console.error('Order not found');
  process.exit(1);
}
const rack =
  (await StorageRack.findOne({ stockType: 'bundles', status: 'active' }).sort({ code: 1 })) ||
  (await StorageRack.create({ code: 'BDL-1', name: 'Bundles rack', stockType: 'bundles', barcode: 'BDL-1', status: 'active' }));
const bundle = await PieceBundle.findOne({ orderId: order.id, number: 1 });
if (!bundle) {
  console.error('Bundle #1 not found');
  process.exit(1);
}
if (bundle.qty < 1) {
  console.error('Bundle empty');
  process.exit(1);
}
bundle.closed = true;
bundle.status = 'closed';
bundle.barcode = bundle.barcode || nextCode('BD');
bundle.rackCode = bundle.rackCode || rack.code;
bundle.floorChecked = true;
bundle.checkedGood = true;
await bundle.save();
console.log(`Fixed ${orderNumber} bundle ${bundle.barcode} qty=${bundle.qty} rack=${bundle.rackCode} closed=${bundle.closed}`);
await mongoose.disconnect();