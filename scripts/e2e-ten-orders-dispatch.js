#!/usr/bin/env node
/**
 * Ten production orders → packing → boxes → partial/full dispatch (service mode).
 *
 *   NODE_ENV=development node --disable-warning=DEP0170 scripts/e2e-ten-orders-dispatch.js
 *   E2E_ORDER_COUNT=3 … for a quicker smoke
 */
import mongoose from 'mongoose';
import cfg from '../src/config/config.js';
import Product from '../src/models/product.model.js';
import StyleCode from '../src/models/styleCode.model.js';
import ProductionRack from '../src/models/productionRack.model.js';
import { ProductionOrder, PieceBundle } from '../src/models/production.model.js';
import { DispatchBox } from '../src/models/warehouse.model.js';
import { QualityResult } from '../src/models/quality.model.js';
import * as packingFloor from '../src/services/warehouse/packingFloor.service.js';
import { shipBoxViaBatch } from '../src/services/warehouse/shipViaBatch.js';
import * as dispatchShipment from '../src/services/warehouse/dispatchShipment.service.js';
import { createDraft, releaseDraft } from '../src/services/production/orderRaise.service.js';
import { bypassFabricIssueForOrder } from '../src/services/factory/fabricIssue.service.js';
import ApiError from '../src/utils/ApiError.js';

const ORDER_COUNT = Math.max(1, Number(process.env.E2E_ORDER_COUNT) || 10);
const PACK_RACK = process.env.E2E_PACK_RACK || 'ST-F-001-C01';
const BOX_RACK = process.env.E2E_BOX_RACK || 'WH-BOX-01';
const FACTORY_CODE = process.env.E2E_FACTORY_CODE || 'HK-D-NORM-01';
const TARGET = Number(process.env.E2E_TARGET_QTY) || 60;

const results = [];
const log = (msg) => console.log(`[e2e-dispatch] ${msg}`);

async function step(name, work) {
  try {
    await work();
    results.push({ name, ok: true });
    log(`PASS ${name}`);
  } catch (err) {
    results.push({ name, ok: false, error: err instanceof Error ? err.message : String(err) });
    log(`FAIL ${name}: ${err instanceof Error ? err.message : err}`);
  }
}

async function ensureRacks() {
  const need = [
    { code: PACK_RACK, stockType: 'packing', name: 'E2E packing' },
    { code: BOX_RACK, stockType: 'box', name: 'E2E box rack' },
  ];
  for (const row of need) {
    const found = await ProductionRack.findOne({ code: row.code });
    if (!found) {
      await ProductionRack.create({ code: row.code, name: row.name, floor: 'warehouse', zone: 'E2E', stockType: row.stockType, status: 'active' });
    }
  }
}

async function ensurePackingQtyOnStyle(productId) {
  const product = await Product.findById(productId).select('styleCodes');
  if (!product?.styleCodes?.length) return;
  const style = await StyleCode.findById(product.styleCodes[0]);
  if (style && (!style.packingBundleQty || style.packingBundleQty < 60)) {
    style.packingBundleQty = 60;
    await style.save();
  }
}

async function createOrder(index, targetQty) {
  const product = await Product.findOne({ factoryCode: FACTORY_CODE });
  if (!product) throw new Error(`Missing product ${FACTORY_CODE} — run seedProductionCatalogDemo`);
  await ensurePackingQtyOnStyle(product.id);
  const draft = await createDraft(
    {
      buyer: `E2E buyer ${index}`,
      priority: 'Medium',
      orderNote: `Dispatch E2E #${index}`,
      lines: [{ itemId: String(product.id), quantity: targetQty, priority: 'Medium', piecesPerCut: product.piecesPerCut || 3, remarks: 'e2e-dispatch' }],
    },
    null
  );
  const released = await releaseDraft(draft.id, { confirm: true }, null);
  await bypassFabricIssueForOrder(String(released.id), null);
  return ProductionOrder.findById(released.id);
}

async function seedBundleReadyForPacking(orderId, qty = TARGET) {
  const bundle = await PieceBundle.create({
    orderId,
    number: 1,
    qty,
    finalGood: qty,
    packedQty: 0,
    closed: true,
    barcode: `BD-E2E-${String(orderId).slice(-6)}`,
    rackCode: PACK_RACK,
    status: 'closed',
    process: 'broken',
    route: 'normal',
    checkedGood: true,
  });
  await QualityResult.create({
    eventId: `e2e-fc-${bundle.barcode}`,
    kind: 'final-checking',
    bundleId: String(bundle.id),
    orderId: String(orderId),
    goodQty: qty,
    defectQty: 0,
    rackCode: PACK_RACK,
    passed: true,
  });
  return bundle;
}

async function packOrderToBox(orderId, { ship = true, vehicle = 'RJ14 E2E' } = {}) {
  const bundle = await PieceBundle.findOne({ orderId, rackCode: PACK_RACK, closed: true });
  if (!bundle) throw new Error('No bundle on packing rack');
  const pb = await packingFloor.packPieces(
    { bundleBarcode: bundle.barcode, pieceCount: bundle.finalGood, scaleWeight: 2.5 },
    {},
    null
  );
  const open = await packingFloor.openBox({}, {}, null);
  await packingFloor.addBundleToBox(
    { boxBarcode: open.barcode, packingBundleBarcode: pb.barcode },
    {},
    null
  );
  await packingFloor.weighBox({ boxBarcode: open.barcode, scaleWeight: 4.2 });
  await packingFloor.markBoxReady({ boxBarcode: open.barcode }, {}, null);
  await packingFloor.storeBox({ boxBarcode: open.barcode, rackCode: BOX_RACK }, {}, null);
  let shipped = null;
  if (ship) {
    shipped = await shipBoxViaBatch(
      { boxBarcode: open.barcode, productionOrderId: String(orderId), vehicleNumber: vehicle, eventId: `e2e-ship-${open.barcode}` },
      null
    );
  }
  const order = await ProductionOrder.findById(orderId);
  return { pb, box: open, shipped, order };
}

async function main() {
  if (cfg.env !== 'development') throw new Error('NODE_ENV=development only');
  await mongoose.connect(cfg.mongoose.url, cfg.mongoose.options);
  await ensureRacks();
  await PieceBundle.deleteMany({ closed: false, qty: 0 });
  const orders = [];

  for (let i = 1; i <= ORDER_COUNT; i += 1) {
    await step(`Create order ${i}/${ORDER_COUNT}`, async () => {
      const target = i === ORDER_COUNT - 1 ? 120 : TARGET;
      const order = await createOrder(i, target);
      await seedBundleReadyForPacking(order.id, i === ORDER_COUNT - 1 ? TARGET : target);
      orders.push({
        id: String(order.id),
        orderNumber: order.orderNumber,
        target,
        index: i,
        partialTarget: i === ORDER_COUNT - 1,
      });
    });
  }

  await step('Packing upcoming lists all seeded bundles', async () => {
    const board = await packingFloor.upcomingPacking();
    if (board.results.length < ORDER_COUNT) {
      throw new Error(`Expected at least ${ORDER_COUNT} waiting bundles, got ${board.results.length}`);
    }
    if (!board.byOrder?.length) throw new Error('byOrder summary missing');
  });

  await step('Edge: destroyed / missing production bundle', async () => {
    const gone = await createOrder(999, TARGET);
    const row = await seedBundleReadyForPacking(gone.id, TARGET);
    const barcode = row.barcode;
    await PieceBundle.deleteOne({ _id: row._id });
    await QualityResult.deleteMany({ bundleId: String(row._id) });
    const err = await packingFloor.packPieces({ bundleBarcode: barcode, pieceCount: TARGET, scaleWeight: 1 }, {}, null).then(
      () => null,
      (e) => e
    );
    if (!(err instanceof ApiError)) throw new Error('Pack after bundle delete should fail');
  });

  await step('Edge: lone bundle order (single BD, full dispatch)', async () => {
    const lone = await createOrder(998, TARGET);
    const row = await seedBundleReadyForPacking(lone.id, TARGET);
    const pb = await packingFloor.packPieces({ bundleBarcode: row.barcode, pieceCount: TARGET, scaleWeight: 1.5 }, {}, null);
    const open = await packingFloor.openBox({}, {}, null);
    await packingFloor.addBundleToBox({ boxBarcode: open.barcode, packingBundleBarcode: pb.barcode }, {}, null);
    await packingFloor.weighBox({ boxBarcode: open.barcode, scaleWeight: 3 });
    await packingFloor.markBoxReady({ boxBarcode: open.barcode }, {}, null);
    await packingFloor.storeBox({ boxBarcode: open.barcode, rackCode: BOX_RACK }, {}, null);
    await shipBoxViaBatch(
      { boxBarcode: open.barcode, productionOrderId: String(lone.id), vehicleNumber: 'LONE-1', eventId: `lone-${open.barcode}` },
      null
    );
    const fresh = await ProductionOrder.findById(lone.id);
    if (fresh.dispatchStatus !== 'complete' || fresh.dispatchedQty !== TARGET) {
      throw new Error(`Lone bundle order should be complete ${TARGET}/${TARGET}`);
    }
  });

  await step('Edge: unknown packing bundle barcode', async () => {
    const err = await packingFloor.packPieces({ bundleBarcode: 'BD-MISSING', pieceCount: 60, scaleWeight: 1 }, {}, null).then(
      () => null,
      (e) => e
    );
    if (!(err instanceof ApiError)) throw new Error('Missing BD barcode should fail');
  });

  await step('Edge: mixed-order box rejected', async () => {
    const mixA = await createOrder('mix-a', TARGET);
    const mixB = await createOrder('mix-b', TARGET);
    await seedBundleReadyForPacking(mixA.id, TARGET);
    await seedBundleReadyForPacking(mixB.id, TARGET);
    const ba = await PieceBundle.findOne({ orderId: mixA.id, rackCode: PACK_RACK });
    const bb = await PieceBundle.findOne({ orderId: mixB.id, rackCode: PACK_RACK });
    const pbA = await packingFloor.packPieces({ bundleBarcode: ba.barcode, pieceCount: TARGET, scaleWeight: 1.1 }, {}, null);
    const pbB = await packingFloor.packPieces({ bundleBarcode: bb.barcode, pieceCount: TARGET, scaleWeight: 1.2 }, {}, null);
    const open = await packingFloor.openBox({}, {}, null);
    await packingFloor.addBundleToBox({ boxBarcode: open.barcode, packingBundleBarcode: pbA.barcode }, {}, null);
    const mixed = await packingFloor
      .addBundleToBox({ boxBarcode: open.barcode, packingBundleBarcode: pbB.barcode }, {}, null)
      .then(
        () => null,
        (e) => e
      );
    if (!(mixed instanceof ApiError)) throw new Error('Two orders in one box should be rejected');
  });

  let fullShipped = 0;
  for (const row of orders) {
    await step(`Pack + box order ${row.index} (${row.orderNumber})`, async () => {
      const out = await packOrderToBox(row.id, { ship: true, vehicle: `VH-${row.index}` });
      if (row.partialTarget) {
        if (out.order.dispatchStatus !== 'partial') {
          throw new Error(`Expected partial dispatch, got ${out.order.dispatchStatus} (${out.order.dispatchedQty}/${out.order.targetQty})`);
        }
      } else if (out.order.dispatchStatus !== 'complete') {
        throw new Error(`Expected dispatch complete, got ${out.order.dispatchStatus} (${out.order.dispatchedQty}/${out.order.targetQty})`);
      }
      if (!row.partialTarget) fullShipped += 1;
    });
  }

  await step('Dispatch summary API + pagination', async () => {
    const { dispatchOrdersSummary } = await import('../src/services/warehouse/orderDispatch.js');
    const summary = await dispatchOrdersSummary();
    if (summary.totalResults < ORDER_COUNT) {
      throw new Error(`Dispatch summary expected ${ORDER_COUNT} orders, got ${summary.totalResults}`);
    }
    const page = await dispatchOrdersSummary({ page: '1', limit: '5' });
    if (page.results.length !== 5 || page.totalPages < 2) {
      throw new Error(`Paginated dispatch summary broken: ${page.results.length} rows, ${page.totalPages} pages`);
    }
  });

  await step('Dispatch batch: partial load then second batch', async () => {
    const partial = orders.find((row) => row.partialTarget);
    if (!partial) return;
    const onRack = await DispatchBox.find({ productionOrderId: partial.id, status: 'on-rack' });
    if (!onRack.length) {
      const extraBarcode = `BD-E2E-P2-${String(partial.id).slice(-6)}`;
      let bundle = await PieceBundle.findOne({ barcode: extraBarcode });
      if (!bundle) {
        bundle = await PieceBundle.create({
          orderId: partial.id,
          number: 2,
          qty: TARGET,
          finalGood: TARGET,
          packedQty: 0,
          closed: true,
          barcode: extraBarcode,
          rackCode: PACK_RACK,
          status: 'closed',
          process: 'broken',
          route: 'normal',
          checkedGood: true,
        });
        await QualityResult.create({
          eventId: `e2e-fc-${extraBarcode}`,
          kind: 'final-checking',
          bundleId: String(bundle.id),
          orderId: partial.id,
          goodQty: TARGET,
          defectQty: 0,
          rackCode: PACK_RACK,
          passed: true,
        });
      }
      const pb = await packingFloor.packPieces({ bundleBarcode: bundle.barcode, pieceCount: TARGET, scaleWeight: 2 }, {}, null);
      const open = await packingFloor.openBox({}, {}, null);
      await packingFloor.addBundleToBox({ boxBarcode: open.barcode, packingBundleBarcode: pb.barcode }, {}, null);
      await packingFloor.weighBox({ boxBarcode: open.barcode, scaleWeight: 5 });
      await packingFloor.markBoxReady({ boxBarcode: open.barcode }, {}, null);
      await packingFloor.storeBox({ boxBarcode: open.barcode, rackCode: BOX_RACK }, {}, null);
      onRack.push(open);
    }
    const box = onRack[0];
    await shipBoxViaBatch(
      { boxBarcode: box.barcode, productionOrderId: partial.id, vehicleNumber: 'BATCH-2', eventId: `e2e-batch2-${box.barcode}` },
      null
    );
    const after = await ProductionOrder.findById(partial.id);
    if (after.dispatchStatus !== 'complete') {
      throw new Error(`Second batch should complete order, got ${after.dispatchStatus} (${after.dispatchedQty}/${after.targetQty})`);
    }
    const batches = await dispatchShipment.listShipments({ productionOrderId: partial.id, status: 'dispatched' });
    if (batches.results.length < 2) throw new Error('Expected at least 2 dispatched batches on partial order');
  });

  await step('Close dispatch tracking hides order when no rack stock', async () => {
    const target = orders[0];
    if (!target) return;
    const onRack = await DispatchBox.countDocuments({ productionOrderId: target.id, status: 'on-rack' });
    if (onRack > 0) return;
    await dispatchShipment.closeDispatchTracking({}, { orderId: target.id }, null);
    const { dispatchOrdersSummary } = await import('../src/services/warehouse/orderDispatch.js');
    const summary = await dispatchOrdersSummary();
    if (summary.results.some((row) => row.orderId === target.id)) {
      throw new Error('Closed order should drop from dispatch summary when nothing on rack');
    }
  });

  console.log('\n=== Dispatch E2E summary ===\n');
  for (const row of results) {
    console.log(`${row.ok ? '✓' : '✗'} ${row.name}${row.ok ? '' : ` — ${row.error}`}`);
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed · ${fullShipped} fully dispatched`);
  if (failed.length) process.exitCode = 1;
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});