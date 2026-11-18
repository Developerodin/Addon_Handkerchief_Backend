/**
 * Audits catalog masters + per-floor upcoming queues for a production order.
 *
 *   NODE_ENV=development node scripts/audit-demo-order-flow.js [orderNumber]
 */
import mongoose from 'mongoose';
import cfg from '../src/config/config.js';
import Product from '../src/models/product.model.js';
import Process from '../src/models/process.model.js';
import Machine from '../src/models/machine.model.js';
import ProductionRack from '../src/models/productionRack.model.js';
import Container from '../src/models/container.model.js';
import { ProductionOrder } from '../src/models/production.model.js';
import { upcomingCuts } from '../src/services/production/verticalCut.service.js';
import { upcomingSelvage } from '../src/services/production/selvage.service.js';
import { upcomingHalfMoon } from '../src/services/production/halfMoon.service.js';
import { upcomingVerticalHem } from '../src/services/production/verticalHem.service.js';
import { upcomingSinglePiece } from '../src/services/production/singlePiece.service.js';
import { upcomingHorizontalHem } from '../src/services/production/horizontalHem.service.js';
import { upcomingThreadCut } from '../src/services/production/threadCut.service.js';
import { upcomingIron } from '../src/services/production/iron.service.js';
import { upcomingFinalQc } from '../src/services/production/finalQc.service.js';
import { upcomingFinalChecking } from '../src/services/production/finalChecking.service.js';
import { upcomingFloorChecks } from '../src/services/production/floorCheck.service.js';
import { upcomingBundleBreak } from '../src/services/production/bundleBreak.service.js';
import { upcomingEmbroidery } from '../src/services/production/embroidery.service.js';
import { upcomingEmbroideryThread } from '../src/services/production/embroideryThread.service.js';
import { upcomingIronAfter } from '../src/services/production/ironAfter.service.js';

const FALLBACK_FACTORY_CODE = 'HK-D-NORM-01';

const FLOOR_SCREENS = [
  { label: 'Vertical cutting', floor: 'vertical-cut', upcoming: () => upcomingCuts() },
  { label: 'Selvage cutting', floor: 'selvage', upcoming: () => upcomingSelvage() },
  { label: 'Half moon', floor: 'half-moon', upcoming: () => upcomingHalfMoon() },
  { label: 'Vertical hemming', floor: 'vertical-hem', upcoming: () => upcomingVerticalHem() },
  { label: 'Single piece cutting', floor: 'single-piece-cutting', upcoming: () => upcomingSinglePiece() },
  { label: 'Floor checks', floor: 'floor-check', upcoming: () => upcomingFloorChecks() },
  { label: 'Horizontal hemming', floor: 'horizontal-hem', upcoming: () => upcomingHorizontalHem() },
  { label: 'Thread cutting', floor: 'thread-cutting', upcoming: () => upcomingThreadCut() },
  { label: 'Final QC', floor: 'final-qc', upcoming: () => upcomingFinalQc() },
  { label: 'Ironing', floor: 'iron', upcoming: () => upcomingIron() },
  { label: 'Route split (embroidery)', floor: 'route-split', upcoming: () => upcomingBundleBreak() },
  { label: 'Embroidery', floor: 'embroidery', upcoming: () => upcomingEmbroidery() },
  { label: 'Embroidery thread cut', floor: 'embroidery-thread-cut', upcoming: () => upcomingEmbroideryThread() },
  { label: 'Iron after embroidery', floor: 'iron-after', upcoming: () => upcomingIronAfter() },
  { label: 'Final checking', floor: 'final-checking', upcoming: () => upcomingFinalChecking() },
];

async function auditMasters() {
  const checks = [];
  const machines = await Machine.countDocuments({ status: 'active' });
  checks.push({
    area: 'Machines',
    ok: machines > 0,
    detail: machines ? `${machines} active machine(s)` : 'No machines — floor start/place will block',
  });
  for (const stockType of ['pieces', 'bundles', 'packing']) {
    const n = await ProductionRack.countDocuments({ stockType, status: 'active' });
    checks.push({
      area: `Racks (${stockType})`,
      ok: n > 0,
      detail: n ? `${n} rack(s)` : `Missing ${stockType} rack — place steps will fail`,
    });
  }
  const bundleContainers = await Container.countDocuments({ type: 'bundle', status: 'active' });
  checks.push({
    area: 'Bundle containers',
    ok: bundleContainers > 0,
    detail: bundleContainers ? `${bundleContainers} container(s)` : 'Need bundle container for Final QC → iron',
  });
  const piecesContainers = await Container.countDocuments({ type: 'pieces', status: 'active' });
  checks.push({
    area: 'Pieces containers',
    ok: piecesContainers > 0,
    detail: piecesContainers ? `${piecesContainers} container(s)` : 'Need pieces container for single-piece / selvage',
  });
  return checks;
}

async function main() {
  await mongoose.connect(cfg.mongoose.url, cfg.mongoose.options);
  const orderNumber = process.argv[2];
  const order = orderNumber
    ? await ProductionOrder.findOne({ orderNumber })
    : await ProductionOrder.findOne().sort({ createdAt: -1 });
  if (!order) throw new Error('No production order found. Run seed:demo-plain-hanky-order or seed:demo-embroidery-order');

  const product = order.itemId
    ? await Product.findById(order.itemId).populate('processes.processId')
  : await Product.findOne({ factoryCode: FALLBACK_FACTORY_CODE }).populate('processes.processId');
  if (!product) throw new Error('Order item not found in catalog');

  const orderFloors = (order.floors || []).map((row) => row.floor);
  const itemFloors = (product.processes || [])
    .map((row) => row.processId?.floor)
    .filter(Boolean);

  console.log(`\n=== Flow audit: ${product.name} (${product.factoryCode}) ===\n`);
  console.log(`Order: ${order.orderNumber} · status ${order.status} · currentFloor "${order.currentFloor || '(none)'}"`);
  console.log(`Item: ${product.name} · productionType ${product.productionType}`);

  console.log('\n--- Item process route vs order floors ---');
  const floorMatch = JSON.stringify(orderFloors) === JSON.stringify(itemFloors);
  console.log(`Item floors (${itemFloors.length}):`, itemFloors.join(' → '));
  console.log(`Order floors (${orderFloors.length}):`, orderFloors.join(' → '));
  console.log(floorMatch ? 'OK: order matches item sequence' : 'MISMATCH: re-release order after process edit');
  if (!floorMatch) {
    const itemSet = new Set(itemFloors);
    const orderSet = new Set(orderFloors);
    const missingOnOrder = itemFloors.filter((f) => !orderSet.has(f));
    const extraOnOrder = orderFloors.filter((f) => !itemSet.has(f));
    if (missingOnOrder.length) console.log('Missing on order:', missingOnOrder.join(', '));
    if (extraOnOrder.length) console.log('Extra on order:', extraOnOrder.join(', '));
  }

  console.log('\n--- Catalog masters ---');
  for (const row of await auditMasters()) {
    console.log(`${row.ok ? '✓' : '✗'} ${row.area}: ${row.detail}`);
  }

  console.log('\n--- Floor queues (this order) ---');
  const orderId = String(order.id);
  for (const screen of FLOOR_SCREENS) {
    const board = await screen.upcoming();
    const rows = (board.results || []).filter((row) => String(row.orderId) === orderId);
    const waiting = board.counts?.waiting ?? rows.length;
    const onOrder = rows.length;
    const routeSplitOk = screen.floor === 'route-split' && orderFloors.includes('embroidery');
    const onRoute = Boolean(screen.floor && (orderFloors.includes(screen.floor) || routeSplitOk));
    const status =
      onOrder > 0 ? `WORK HERE (${onOrder} waiting)` : onRoute ? 'idle / not reached yet' : 'not on route';
    console.log(`  ${screen.label.padEnd(28)} ${status}`);
  }

  const qcProcesses = await Process.find({ code: { $in: ['FLC', 'FQC', 'FCH'] } }).select('name code floor');
  console.log('\n--- QC in process master ---');
  qcProcesses.forEach((row) => console.log(`  ✓ ${row.name} (${row.code}) → ${row.floor}`));
  if (qcProcesses.length < 3) console.log('  ✗ QC process masters incomplete');

  const cuts = await upcomingCuts();
  const rollsForOrder = (cuts.results || []).filter((row) => String(row.orderId) === orderId);

  console.log('\n--- Summary ---');
  const mastersOk = (await auditMasters()).every((row) => row.ok);
  console.log(mastersOk ? 'Masters: OK for a full manual walk' : 'Masters: gaps — add catalog machines/racks/containers before full flow');
  if (rollsForOrder.length > 0) {
    console.log(`Order creation → fabric issue → vertical cutting: READY (${rollsForOrder.length} roll(s) in upcoming)`);
  } else if (order.status === 'released' || order.status === 'in-progress') {
    console.log('Order released but no rolls at vertical cutting — issue fabric or check BOM fabric id match');
  } else {
    console.log('Order not released — release from production orders UI');
  }

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