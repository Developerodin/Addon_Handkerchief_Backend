import mongoose from 'mongoose';
import config from '../src/config/config.js';
import { PieceBundle, ProductionOrder } from '../src/models/production.model.js';
import { QualityResult } from '../src/models/quality.model.js';

const orderNumber = process.argv[2] || 'ORD-000003';
const barcode = process.argv[3];

await mongoose.connect(config.mongoose.url, config.mongoose.options);
const order = await ProductionOrder.findOne({ orderNumber }).select('orderNumber productionType');
if (!order) {
  console.log('Order not found');
  process.exit(1);
}
const bundle = barcode
  ? await PieceBundle.findOne({ orderId: order.id, barcode })
  : await PieceBundle.findOne({ orderId: order.id }).sort({ number: 1 });
if (!bundle) {
  console.log('Bundle not found');
  process.exit(1);
}
const q = await QualityResult.find({ bundleId: String(bundle.id) }).select('kind goodQty m2Qty defectQty passed grades createdAt');
console.log(`\n${order.orderNumber} · ${bundle.barcode} · qty=${bundle.qty}`);
console.log(JSON.stringify(
  {
    closed: bundle.closed,
    process: bundle.process,
    route: bundle.route,
    rackCode: bundle.rackCode,
    machineBarcode: bundle.machineBarcode,
    containerBarcode: bundle.containerBarcode,
    finalGood: bundle.finalGood,
    checkedGood: bundle.checkedGood,
    floorChecked: bundle.floorChecked,
  },
  null,
  2
));
console.log(
  '\nQuality events:',
  q.map((r) => `${r.kind} good=${r.goodQty} m2=${r.m2Qty ?? r.defectQty}`).join(' | ') || '(none)'
);

const screens = [];
const p = bundle.process;
const r = bundle.route || '';
const rack = String(bundle.rackCode || '').trim();
const fg = bundle.finalGood || 0;

if (p === 'created' && bundle.checkedGood && rack) screens.push('Horizontal hemming (upcoming)');
if (p === 'horizontal-hem' || (p === 'created' && bundle.machineBarcode)) screens.push('Horizontal hemming (on machine)');
if (p === 'horizontal-hem' && rack) screens.push('Thread cutting (upcoming)');
if (p === 'thread-cut' && rack) screens.push('Final QC (upcoming)');
if (p === 'final-qc' && fg > 0 && rack) screens.push('Move to ground (upcoming)');
if (p === 'final-qc' && bundle?.finalGood > 0 && bundle?.rackCode) screens.push('Ironing (upcoming)');
if (p === 'in-container') screens.push('Ironing (legacy in-container — use final-qc rack queue)');
if (p === 'ironed' && rack) screens.push('Route split / bundle break (upcoming)');
if (p === 'broken' && r === 'embroidery' && rack) screens.push('Embroidery (upcoming)');
if (p === 'broken' && r === 'sticker' && rack) screens.push('Sticker (upcoming)');
if (p === 'broken' && r === 'normal' && rack) screens.push('Final checking (upcoming) — normal route');
if (p === 'embroidered' || p === 'sticker') screens.push('Iron-after or embroidery thread cut (route dependent)');
if (p === 'iron-after' && rack) screens.push('Final checking (upcoming)');
if (p === 'broken' && !r) screens.push('(broken but route empty — need route on break; or on machine if no rack)');

const skip = [];
if (p === 'broken') {
  skip.push('Route split — already broken (done here)');
  if (!rack && !bundle.machineBarcode) skip.push('Embroidery/Sticker/Final check — need rack or machine after break');
}
if (!q.some((x) => x.kind === 'final-qc')) skip.push('May have skipped Final QC in DB');

console.log('\nShould appear on:', screens.length ? screens.join('\n  · ') : '(no matching upcoming screen)');
console.log('\nWhy not on route-split:', skip.join('; ') || 'Check process=ironed + rack');
await mongoose.disconnect();