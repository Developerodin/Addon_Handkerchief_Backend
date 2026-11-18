#!/usr/bin/env node
/**
 * Multi-order E2E: fabric issue → vertical cut → final checking + edge cases.
 *
 *   API_BASE_URL=http://localhost:5001/v1 NODE_ENV=development node scripts/e2e-multi-order-flow.js
 *
 * Uses production services directly (default). Set E2E_HTTP=1 to drive HTTP instead (needs E2E_AUTH_PASSWORD).
 */
import httpStatus from 'http-status';
import mongoose from 'mongoose';
import cfg from '../src/config/config.js';
import Product from '../src/models/product.model.js';
import StorageRack from '../src/models/storageRack.model.js';
import { FabricLot, FabricRoll, GoodsReceipt, PurchaseOrder } from '../src/models/store.model.js';
import { ProductionOrder, PieceBundle } from '../src/models/production.model.js';
import { createDraft, releaseDraft } from '../src/services/production/orderRaise.service.js';
import { issueFabricRoll, bypassFabricIssueForOrder } from '../src/services/factory/fabricIssue.service.js';
import { placeRoll } from '../src/services/factory/rackSlots.service.js';
import { nextCode } from '../src/services/factory/ids.js';
import * as verticalCut from '../src/services/production/verticalCut.service.js';
import * as selvage from '../src/services/production/selvage.service.js';
import * as halfMoon from '../src/services/production/halfMoon.service.js';
import * as verticalHem from '../src/services/production/verticalHem.service.js';
import * as singlePiece from '../src/services/production/singlePiece.service.js';
import * as horizontalHem from '../src/services/production/horizontalHem.service.js';
import * as threadCut from '../src/services/production/threadCut.service.js';
import * as finalQc from '../src/services/production/finalQc.service.js';
import * as iron from '../src/services/production/iron.service.js';
import * as embroidery from '../src/services/production/embroidery.service.js';
import * as embroideryThread from '../src/services/production/embroideryThread.service.js';
import * as ironAfter from '../src/services/production/ironAfter.service.js';
import * as finalCheckingSvc from '../src/services/production/finalChecking.service.js';
import * as quality from '../src/services/quality.service.js';
import * as packingFloor from '../src/services/warehouse/packingFloor.service.js';
import ProductionRack from '../src/models/productionRack.model.js';
import StyleCode from '../src/models/styleCode.model.js';
import ApiError from '../src/utils/ApiError.js';

const USE_HTTP = process.env.E2E_HTTP === '1';
const e2eUser = null;

const API_BASE = process.env.API_BASE_URL || 'http://localhost:5001/v1';
const AUTH_EMAIL = process.env.E2E_AUTH_EMAIL || process.env.SMOKE_AUTH_EMAIL || 'superadmin@addon.in';
const AUTH_PASSWORD = process.env.E2E_AUTH_PASSWORD || process.env.SMOKE_AUTH_PASSWORD || 'SuperAdmin1';

const RACK_PIECES = 'ST-F-001-B01';
const RACK_BUNDLE_A = 'ST-F-001-A01';
const RACK_BUNDLE_B = 'ST-F-001-A02';
const RACK_PACK = 'ST-F-001-C01';
const CONTAINER_PIECES = 'FLOW-PIECE-BOX';
const MACHINE = process.env.E2E_MACHINE_BARCODE || 'MC-CUT-01';

const BUNDLE_SIZE = 60;
const results = [];

let token = '';

/** @type {Record<string, (body: object) => Promise<unknown>>} */
const SERVICE_POST = {
  '/production/cuts': (body) => verticalCut.cutRoll(body, {}, e2eUser),
  '/production/cuts/place': (body) => verticalCut.placePieces(body, {}, e2eUser),
  '/production/selvage/start': (body) => selvage.startSelvage(body, {}, e2eUser),
  '/production/selvage/place': (body) => selvage.placeSelvage(body, {}, e2eUser),
  '/production/half-moon/start': (body) => halfMoon.startHalfMoon(body, {}, e2eUser),
  '/production/half-moon/place': (body) => halfMoon.placeHalfMoon(body, {}, e2eUser),
  '/production/vertical-hem/start': (body) => verticalHem.startVerticalHem(body, {}, e2eUser),
  '/production/vertical-hem/place': (body) => verticalHem.placeVerticalHem(body, {}, e2eUser),
  '/production/single-piece/start': (body) => singlePiece.startSinglePiece(body, {}, e2eUser),
  '/production/single-piece/cut': (body) => singlePiece.cutSinglePiece(body, {}, e2eUser),
  '/production/single-piece/close': (body) => singlePiece.closeSinglePiece(body, {}, e2eUser),
  '/production/single-piece/place': (body) => singlePiece.placeSinglePiece(body, {}, e2eUser),
  '/production/horizontal-hem/start': (body) => horizontalHem.startHorizontalHem(body, {}, e2eUser),
  '/production/horizontal-hem/place': (body) => horizontalHem.placeHorizontalHem(body, {}, e2eUser),
  '/production/thread-cut/start': (body) => threadCut.startThreadCut(body, {}, e2eUser),
  '/production/thread-cut/place': (body) => threadCut.placeThreadCut(body, {}, e2eUser),
  '/quality/final-qc': (body) => finalQc.recordFinalQc(body, {}, e2eUser),
  '/production/iron/start': (body) => iron.startIron(body, {}, e2eUser),
  '/production/iron/place': (body) => iron.placeIron(body, {}, e2eUser),
  '/production/embroidery/start': (body) => embroidery.startEmbroidery(body, {}, e2eUser),
  '/production/embroidery/place': (body) => embroidery.placeEmbroidery(body, {}, e2eUser),
  '/production/embroidery-thread-cut/start': (body) => embroideryThread.startEmbroideryThread(body, {}, e2eUser),
  '/production/embroidery-thread-cut/place': (body) => embroideryThread.placeEmbroideryThread(body, {}, e2eUser),
  '/production/iron-after/start': (body) => ironAfter.startIronAfter(body, {}, e2eUser),
  '/production/iron-after/place': (body) => ironAfter.placeIronAfter(body, {}, e2eUser),
  '/quality/final-checking': (body) => finalCheckingSvc.recordFinalChecking(body, {}, e2eUser),
  '/quality/bundle-checks': (body) => quality.recordBundleCheck(body, {}, e2eUser),
};

/** @type {Record<string, () => Promise<unknown>>} */
const SERVICE_GET = {
  '/production/iron/upcoming': () => iron.upcomingIron(),
};

const log = (msg, extra) => {
  const tail = extra !== undefined ? ` ${typeof extra === 'string' ? extra : JSON.stringify(extra)}` : '';
  console.log(`[e2e] ${msg}${tail}`);
};

async function request(method, path, body = null) {
  if (!USE_HTTP) {
    try {
      if (method === 'GET') {
        const work = SERVICE_GET[path];
        if (!work) throw new Error(`No service mapping for GET ${path}`);
        const data = await work();
        return { status: httpStatus.OK, data };
      }
      if (method === 'POST') {
        const work = SERVICE_POST[path];
        if (!work) throw new Error(`No service mapping for POST ${path}`);
        const data = await work(body || {});
        const status =
          path === '/production/cuts' || path === '/production/single-piece/cut' || path === '/quality/bundle-checks'
            ? httpStatus.CREATED
            : httpStatus.OK;
        return { status, data };
      }
      throw new Error(`Unsupported method ${method}`);
    } catch (err) {
      if (err instanceof ApiError) {
        return { status: err.statusCode, data: { message: err.message } };
      }
      throw err;
    }
  }
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  };
  if (body != null && method !== 'GET') opts.body = JSON.stringify(body);
  const res = await fetch(`${API_BASE}${path}`, opts);
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

async function login() {
  if (!USE_HTTP) {
    log('Mode', 'direct services (set E2E_HTTP=1 for HTTP)');
    return;
  }
  const res = await request('POST', '/auth/login', { email: AUTH_EMAIL, password: AUTH_PASSWORD });
  if (res.status !== 200 || !res.data?.tokens?.access?.token) {
    throw new Error(`Login failed (${res.status}): ${res.data?.message || 'no token'}`);
  }
  token = res.data.tokens.access.token;
  log('Logged in', AUTH_EMAIL);
}

/**
 * @param {string} name
 * @param {() => Promise<void>} work
 */
async function step(name, work) {
  try {
    await work();
    results.push({ name, ok: true });
    log(`PASS ${name}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    results.push({ name, ok: false, error: message });
    log(`FAIL ${name}: ${message}`);
  }
}

function expectStatus(res, expected, label) {
  if (res.status !== expected) {
    const detail = typeof res.data === 'object' ? res.data?.message || JSON.stringify(res.data) : res.data;
    throw new Error(`${label}: expected HTTP ${expected}, got ${res.status} — ${detail}`);
  }
}

function fabricFromProduct(product) {
  const row = (product?.bom || []).find((line) => line.fabricCatalogId || line.fabricName);
  if (!row) return null;
  return {
    bomLineId: String(row.bomLineId || row._id || 'bom-1'),
    fabricCatalogId: String(row.fabricCatalogId?._id || row.fabricCatalogId || ''),
    fabricName: row.fabricName || 'Demo fabric',
    metresPerPiece: Number(row.quantity) || 0.12,
  };
}

async function ensureFabricRack(code) {
  let rack = await StorageRack.findOne({ code });
  if (!rack) {
    rack = await StorageRack.create({
      code,
      barcode: code,
      name: 'E2E fabric rack',
      stockType: 'fabric',
      status: 'active',
    });
  }
  return rack.code;
}

async function createDemoRoll(fabric, rackCode) {
  const po = await PurchaseOrder.create({
    number: nextCode('PO'),
    supplierName: 'E2E supplier',
    status: 'Received',
    lines: [{ lineId: 'L1', fabricId: fabric.fabricCatalogId, fabricName: fabric.fabricName, quantity: 100 }],
  });
  const lot = await FabricLot.create({
    poId: po.id,
    status: 'approved',
    qcStatus: 'passed',
    cutoffs: fabric.fabricCatalogId ? [{ fabricId: fabric.fabricCatalogId, approved: true }] : [],
  });
  const grn = await GoodsReceipt.create({
    number: nextCode('GRN'),
    lotId: lot.id,
    poId: po.id,
    netWeight: 20,
    grossWeight: 21,
  });
  const barcode = nextCode('RL');
  await FabricRoll.create({
    barcode,
    lotId: lot.id,
    grnId: grn.id,
    poId: po.id,
    fabricId: fabric.fabricCatalogId,
    fabricName: fabric.fabricName,
    rollCode: barcode,
    grossWeight: 10,
    netWeight: 9,
    qtyMeters: 50,
    currentGrossWeight: 10,
    currentNetWeight: 9,
    currentQtyMeters: 50,
    scaleWeight: 10,
    qcStatus: 'passed',
    status: 'stored',
  });
  await placeRoll({ rollBarcode: barcode, rackCode, eventId: `e2e-rack-${barcode}` }, null);
  return barcode;
}

/**
 * @param {string} factoryCode
 * @param {number} quantity
 * @param {string} note
 */
async function createReleasedOrder(factoryCode, quantity, note) {
  const product = await Product.findOne({ factoryCode });
  if (!product) throw new Error(`Product ${factoryCode} not found`);
  const fabric = fabricFromProduct(product);
  if (!fabric?.fabricCatalogId) throw new Error(`Product ${factoryCode} has no fabric BOM`);

  const draft = await createDraft(
    {
      buyer: 'E2E buyer',
      priority: 'High',
      orderNote: note,
      lines: [
        {
          itemId: String(product.id),
          quantity,
          priority: 'High',
          piecesPerCut: product.piecesPerCut || 3,
          remarks: 'e2e',
        },
      ],
    },
    null
  );
  const released = await releaseDraft(draft.id, { confirm: true }, null);
  const line = released.lines[0];
  const lineId = String(line.id || line._id);
  const bomLine = line.snapshot?.fabricBom?.[0] || fabric;

  const fabricRack = await ensureFabricRack(`E2E-FAB-${factoryCode}`);
  const rollBarcode = await createDemoRoll(fabric, fabricRack);
  await issueFabricRoll(
    {
      orderId: String(released.id),
      lineId,
      bomLineId: String(bomLine.bomLineId || fabric.bomLineId),
      rollBarcode,
      eventId: `e2e-issue-${rollBarcode}`,
    },
    null
  );
  await bypassFabricIssueForOrder(String(released.id), null);
  const fresh = await ProductionOrder.findById(released.id);
  return { order: fresh, rollBarcode, product };
}

async function walkPieceToBundle(orderId, rollBarcode, pieceBarcode) {
  const pieceRack = RACK_PIECES;
  const bundleRack = RACK_BUNDLE_A;

  let res = await request('POST', '/production/cuts', {
    orderId,
    rollBarcode,
    machineBarcode: MACHINE,
  });
  expectStatus(res, 201, 'vertical cut');
  const pieces = res.data;
  const piece = pieceBarcode || pieces[0]?.barcode;
  if (!piece) throw new Error('No cut pieces');

  res = await request('POST', '/production/cuts/place', {
    pieceBarcodes: [piece],
    containerBarcode: CONTAINER_PIECES,
    rackCode: pieceRack,
  });
  expectStatus(res, 200, 'cuts place');

  for (const floor of ['selvage', 'half-moon']) {
    res = await request('POST', `/production/${floor}/start`, {
      pieceBarcodes: [piece],
      rackCode: pieceRack,
      machineBarcode: MACHINE,
    });
    expectStatus(res, 200, `${floor} start`);
    res = await request('POST', `/production/${floor}/place`, { pieceBarcodes: [piece], rackCode: pieceRack });
    expectStatus(res, 200, `${floor} place`);
  }

  res = await request('POST', '/production/vertical-hem/start', {
    pieceBarcodes: [piece],
    rackCode: pieceRack,
    machineBarcode: MACHINE,
  });
  expectStatus(res, 200, 'vertical-hem start');
  res = await request('POST', '/production/vertical-hem/place', {
    pieceBarcodes: [piece],
    rackCode: pieceRack,
    threadQuantity: 2,
  });
  expectStatus(res, 200, 'vertical-hem place');

  res = await request('POST', '/production/single-piece/start', {
    pieceBarcodes: [piece],
    rackCode: pieceRack,
    machineBarcode: MACHINE,
  });
  expectStatus(res, 200, 'single-piece start');

  res = await request('POST', '/production/single-piece/cut', {
    pieces: [{ barcode: piece, goodQty: BUNDLE_SIZE, m4Qty: 0 }],
  });
  expectStatus(res, 201, 'single-piece cut');
  const closedRows = res.data?.closed || [];
  const closed60 = closedRows.find((row) => row.qty === BUNDLE_SIZE) || closedRows[0];
  let bundleBarcode = closed60?.barcode;
  if (!bundleBarcode?.startsWith('BD-')) {
    res = await request('POST', '/production/single-piece/close', { orderId });
    expectStatus(res, 200, 'single-piece close');
    bundleBarcode = res.data?.barcode;
  }
  if (!bundleBarcode?.startsWith('BD-')) throw new Error('Bundle barcode missing after single-piece cut');

  res = await request('POST', '/production/single-piece/place', {
    bundleBarcodes: [bundleBarcode],
    rackCode: bundleRack,
  });
  expectStatus(res, 200, 'single-piece place bundle');

  const bundle = await PieceBundle.findOne({ barcode: bundleBarcode });
  if (!bundle) throw new Error('Bundle not in DB');
  res = await request('POST', '/quality/bundle-checks', {
    eventId: `e2e-bc-${bundleBarcode}`,
    bundleId: String(bundle.id),
    goodQty: bundle.qty,
    m2Qty: 0,
    m4Qty: 0,
  });
  expectStatus(res, 201, 'floor bundle check');

  res = await request('POST', '/production/horizontal-hem/start', {
    bundleBarcodes: [bundleBarcode],
    rackCode: bundleRack,
    machineBarcode: MACHINE,
  });
  expectStatus(res, 200, 'horizontal-hem start');
  res = await request('POST', '/production/horizontal-hem/place', {
    bundleBarcodes: [bundleBarcode],
    rackCode: RACK_BUNDLE_B,
    threadQuantity: 1,
  });
  expectStatus(res, 200, 'horizontal-hem place');

  res = await request('POST', '/production/thread-cut/start', {
    bundleBarcodes: [bundleBarcode],
    rackCode: RACK_BUNDLE_B,
    machineBarcode: MACHINE,
  });
  expectStatus(res, 200, 'thread-cut start');
  res = await request('POST', '/production/thread-cut/place', {
    bundleBarcodes: [bundleBarcode],
    rackCode: RACK_BUNDLE_A,
  });
  expectStatus(res, 200, 'thread-cut place');

  return { bundleBarcode, bundle };
}

async function finalQcIronNormal(bundleBarcode, { good = BUNDLE_SIZE, long = 0 } = {}) {
  let res = await request('POST', '/quality/final-qc', {
    bundleBarcode,
    good,
    long,
    hemming: 0,
    sporting: 0,
    diving: 0,
    rejection: long ? 0 : 0,
    racks: long > 0 ? { long: RACK_BUNDLE_B } : {},
  });
  if (long > 0) {
    expectStatus(res, 200, 'final-qc with long');
  } else {
    expectStatus(res, 200, 'final-qc all good');
  }

  res = await request('POST', '/production/iron/start', {
    bundleBarcodes: [bundleBarcode],
    rackCode: RACK_BUNDLE_A,
    machineBarcode: MACHINE,
  });
  expectStatus(res, 200, 'iron start');
  res = await request('POST', '/production/iron/place', {
    bundleBarcodes: [bundleBarcode],
    rackCode: RACK_BUNDLE_B,
  });
  expectStatus(res, 200, 'iron place');
  return res.data?.[0] || res.data;
}

async function embroideryAfterIron(bundleBarcode) {
  let res = await request('POST', '/production/embroidery/start', {
    bundleBarcodes: [bundleBarcode],
    rackCode: RACK_BUNDLE_B,
    machineBarcode: MACHINE,
  });
  expectStatus(res, 200, 'embroidery start');
  res = await request('POST', '/production/embroidery/place', {
    bundleBarcodes: [bundleBarcode],
    rackCode: RACK_BUNDLE_A,
    threadQuantity: 2,
  });
  expectStatus(res, 200, 'embroidery place');

  res = await request('POST', '/production/embroidery-thread-cut/start', {
    bundleBarcodes: [bundleBarcode],
    rackCode: RACK_BUNDLE_A,
    machineBarcode: MACHINE,
  });
  expectStatus(res, 200, 'embroidery-thread-cut start');
  res = await request('POST', '/production/embroidery-thread-cut/place', {
    bundleBarcodes: [bundleBarcode],
    rackCode: RACK_BUNDLE_B,
  });
  expectStatus(res, 200, 'embroidery-thread-cut place');

  res = await request('POST', '/production/iron-after/start', {
    bundleBarcodes: [bundleBarcode],
    rackCode: RACK_BUNDLE_B,
    machineBarcode: MACHINE,
  });
  expectStatus(res, 200, 'iron-after start');
  res = await request('POST', '/production/iron-after/place', {
    bundleBarcodes: [bundleBarcode],
    rackCode: RACK_BUNDLE_A,
  });
  expectStatus(res, 200, 'iron-after place');
}

async function finalChecking(bundleBarcode, good, defect = 0) {
  const res = await request('POST', '/quality/final-checking', {
    bundleBarcode,
    good,
    defect,
    rackCode: good > 0 ? RACK_PACK : RACK_BUNDLE_A,
  });
  expectStatus(res, 200, 'final-checking');
  return res.data;
}

async function getOrder(orderId) {
  if (!USE_HTTP) {
    const order = await ProductionOrder.findById(orderId);
    if (!order) throw new Error('Order not found');
    return order.toJSON();
  }
  const res = await request('GET', `/production/orders/${orderId}`);
  expectStatus(res, 200, 'get order');
  return res.data;
}

async function ensurePackingStyle() {
  const product = await Product.findOne({ factoryCode: 'HK-D-NORM-01' });
  if (product?.styleCodes?.length) {
    const style = await StyleCode.findById(product.styleCodes[0]);
    if (style && (!style.packingBundleQty || style.packingBundleQty < 60)) {
      style.packingBundleQty = 60;
      await style.save();
    }
  }
  let rack = await ProductionRack.findOne({ code: 'WH-BOX-01' });
  if (!rack) {
    await ProductionRack.create({
      code: 'WH-BOX-01',
      name: 'E2E box',
      floor: 'warehouse',
      zone: 'E2E',
      stockType: 'box',
      status: 'active',
    });
  }
}

/**
 * Pack one production bundle on the packing rack through to factory dispatch.
 * @param {string} bundleBarcode
 * @param {string} orderId
 * @param {{ expectPartial?: boolean }} options
 */
async function packDispatchOrder(bundleBarcode, orderId, { expectPartial = false } = {}) {
  await ensurePackingStyle();
  const pb = await packingFloor.packPieces({ bundleBarcode, pieceCount: BUNDLE_SIZE, scaleWeight: 2.2 }, {}, null);
  const open = await packingFloor.openBox({}, {}, null);
  await packingFloor.addBundleToBox({ boxBarcode: open.barcode, packingBundleBarcode: pb.barcode }, {}, null);
  await packingFloor.weighBox({ boxBarcode: open.barcode, scaleWeight: 4.1 });
  await packingFloor.markBoxReady({ boxBarcode: open.barcode }, {}, null);
  await packingFloor.storeBox({ boxBarcode: open.barcode, rackCode: 'WH-BOX-01' }, {}, null);
  await packingFloor.shipBox(
    { boxBarcode: open.barcode, vehicleNumber: 'E2E-FLOOR', eventId: `e2e-floor-${open.barcode}`, site: 'factory' },
    {},
    null
  );
  const orderRow = await ProductionOrder.findById(orderId);
  if (expectPartial) {
    if (orderRow.dispatchStatus !== 'partial') {
      throw new Error(`Expected partial dispatch, got ${orderRow.dispatchStatus} (${orderRow.dispatchedQty}/${orderRow.targetQty})`);
    }
  } else if (orderRow.dispatchStatus !== 'complete') {
    throw new Error(`Dispatch should be complete, got ${orderRow.dispatchStatus}`);
  }
}

async function run() {
  if (cfg.env !== 'development') {
    throw new Error('Run with NODE_ENV=development only');
  }
  await mongoose.connect(cfg.mongoose.url, cfg.mongoose.options);
  log('API', API_BASE);

  await login();

  const floorLoop = Number(process.env.E2E_FLOOR_LOOP) || 0;
  if (floorLoop > 0) {
    for (let i = 1; i <= floorLoop; i += 1) {
      const partial = i === floorLoop - 1;
      const qty = partial ? 120 : BUNDLE_SIZE;
      await step(`Floor→dispatch ${i}/${floorLoop}${partial ? ' (partial)' : ''}`, async () => {
        const { order, rollBarcode } = await createReleasedOrder('HK-D-NORM-01', qty, `Ten floor ${i}`);
        const orderId = String(order.id);
        const { bundleBarcode } = await walkPieceToBundle(orderId, rollBarcode);
        await finalQcIronNormal(bundleBarcode);
        await finalChecking(bundleBarcode, BUNDLE_SIZE, 0);
        await packDispatchOrder(bundleBarcode, orderId, { expectPartial: partial });
        const logs = await ProductionOrder.findById(orderId);
        if (!logs?.orderNumber) throw new Error('Order missing orderNumber after pipeline');
      });
    }
    console.log('\n=== Ten floor→dispatch summary ===\n');
    for (const row of results) {
      console.log(`${row.ok ? '✓' : '✗'} ${row.name}${row.ok ? '' : ` — ${row.error}`}`);
    }
    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} passed`);
    await mongoose.disconnect();
    if (failed.length) process.exitCode = 1;
    if (process.env.E2E_FLOOR_ONLY === '1') return;
  }

  let normBundle = '';

  await step('Normal HK-D-NORM-01: floors → final checking (60) → order closed', async () => {
    const { order, rollBarcode } = await createReleasedOrder('HK-D-NORM-01', BUNDLE_SIZE, 'E2E normal happy path');
    const orderId = String(order.id);
    const walked = await walkPieceToBundle(orderId, rollBarcode);
    normBundle = walked.bundleBarcode;
    await finalQcIronNormal(normBundle);
    await finalChecking(normBundle, BUNDLE_SIZE, 0);
    const orderRow = await getOrder(orderId);
    if (orderRow.status !== 'closed') {
      throw new Error(`Expected closed, got ${orderRow.status} (target ${orderRow.targetQty})`);
    }
  });

  await step('Embroidery HK-D-EMB-01: embroidery route → final checking → closed', async () => {
    const { order, rollBarcode } = await createReleasedOrder('HK-D-EMB-01', BUNDLE_SIZE, 'E2E embroidery');
    const orderId = String(order.id);
    const { bundleBarcode } = await walkPieceToBundle(orderId, rollBarcode);
    await finalQcIronNormal(bundleBarcode);
    const afterIron = await PieceBundle.findOne({ barcode: bundleBarcode });
    if (afterIron?.route !== 'embroidery' || afterIron?.process !== 'broken') {
      throw new Error(`After iron expected broken/embroidery, got ${afterIron?.process}/${afterIron?.route}`);
    }
    await embroideryAfterIron(bundleBarcode);
    await finalChecking(bundleBarcode, BUNDLE_SIZE, 0);
    const orderRow = await getOrder(orderId);
    if (orderRow.status !== 'closed') throw new Error(`Embroidery order not closed: ${orderRow.status}`);
  });

  await step('Edge: final QC all-defect — bundle does not reach iron', async () => {
    const { order, rollBarcode } = await createReleasedOrder('HK-D-NORM-01', BUNDLE_SIZE, 'E2E all-defect QC');
    const { bundleBarcode } = await walkPieceToBundle(String(order.id), rollBarcode);
    let res = await request('POST', '/quality/final-qc', {
      bundleBarcode,
      good: 0,
      long: 0,
      hemming: 0,
      sporting: 0,
      diving: 0,
      rejection: BUNDLE_SIZE,
      racks: { rejection: RACK_BUNDLE_B },
    });
    expectStatus(res, 200, 'final-qc all rejection');
    const bundle = await PieceBundle.findOne({ barcode: bundleBarcode });
    if (bundle?.finalGood !== 0) throw new Error('finalGood should be 0');
    if (bundle?.process !== 'final-qc-defect') throw new Error(`Expected final-qc-defect, got ${bundle?.process}`);
    res = await request('GET', '/production/iron/upcoming');
    expectStatus(res, 200, 'iron upcoming');
    const onIron = (res.data?.results || []).some((row) => row.barcode === bundleBarcode);
    if (onIron) throw new Error('All-defect bundle should not appear on iron');
  });

  await step('Edge: shortfall — 120 target, 60 final-checked, order stays open', async () => {
    const target = 120;
    const { order, rollBarcode } = await createReleasedOrder('HK-D-NORM-01', target, 'E2E shortfall');
    const { bundleBarcode } = await walkPieceToBundle(String(order.id), rollBarcode);
    await finalQcIronNormal(bundleBarcode);
    await finalChecking(bundleBarcode, BUNDLE_SIZE, 0);
    const fresh = await getOrder(String(order.id));
    if (fresh.status === 'closed') throw new Error('Order should not close with 60/120 final checking good');
    if (Number(fresh.targetQty) !== target) throw new Error(`targetQty mismatch ${fresh.targetQty}`);
  });

  await step('Edge: duplicate final-checking rejected', async () => {
    const res = await request('POST', '/quality/final-checking', {
      bundleBarcode: normBundle,
      good: 10,
      defect: 0,
      rackCode: RACK_PACK,
    });
    if (res.status !== 400) throw new Error(`Expected 400 on duplicate final-checking, got ${res.status}`);
  });

  await step('Edge: wrong rack on final-checking (bundles rack)', async () => {
    const { order, rollBarcode } = await createReleasedOrder('HK-D-NORM-01', BUNDLE_SIZE, 'E2E wrong rack');
    const { bundleBarcode } = await walkPieceToBundle(String(order.id), rollBarcode);
    await finalQcIronNormal(bundleBarcode);
    const res = await request('POST', '/quality/final-checking', {
      bundleBarcode,
      good: BUNDLE_SIZE,
      defect: 0,
      rackCode: RACK_BUNDLE_A,
    });
    if (res.status !== 400) throw new Error(`Expected 400 for bundles rack on final-checking, got ${res.status}`);
  });

  await step('Normal order: full floor → pack → box → dispatch complete', async () => {
    const bundle = await PieceBundle.findOne({ barcode: normBundle });
    if (!bundle?.rackCode) throw new Error('Bundle missing packing rack after final checking');
    const orderId = String(bundle.orderId);
    await packDispatchOrder(normBundle, orderId);
    const badPack = await packingFloor.packPieces({ bundleBarcode: 'BD-NOPE', pieceCount: 60, scaleWeight: 1 }, {}, null).then(
      () => null,
      (err) => err
    );
    if (!(badPack instanceof ApiError)) throw new Error('Missing bundle barcode should fail pack');
  });

  await step('Edge: cut same roll twice rejected', async () => {
    const { order, rollBarcode } = await createReleasedOrder('HK-D-NORM-01', BUNDLE_SIZE, 'E2E double cut');
    const res1 = await request('POST', '/production/cuts', {
      orderId: String(order.id),
      rollBarcode,
      machineBarcode: MACHINE,
    });
    expectStatus(res1, 201, 'first cut');
    const res2 = await request('POST', '/production/cuts', {
      orderId: String(order.id),
      rollBarcode,
      machineBarcode: MACHINE,
    });
    if (res2.status !== 400) throw new Error(`Second cut should be 400, got ${res2.status}`);
  });

  console.log('\n=== E2E summary ===\n');
  const pad = (s, n) => String(s).padEnd(n);
  const width = Math.max(...results.map((r) => r.name.length), 12);
  for (const row of results) {
    console.log(`${row.ok ? '✓' : '✗'} ${pad(row.name, width)}  ${row.ok ? 'OK' : row.error}`);
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exitCode = 1;

  await mongoose.disconnect();
}

run().catch(async (err) => {
  console.error('[e2e] Fatal:', err instanceof Error ? err.message : err);
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});