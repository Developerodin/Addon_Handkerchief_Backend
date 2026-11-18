/**
 * Creates one released order, issues four rolls, and prints vertical-cutting test info.
 *
 *   npm run seed:vertical-cut-demo
 */
import mongoose from 'mongoose';
import cfg from '../src/config/config.js';
import Product from '../src/models/product.model.js';
import FabricCatalog from '../src/models/fabricCatalog.model.js';
import StorageRack from '../src/models/storageRack.model.js';
import { FabricLot, FabricRoll, GoodsReceipt, PurchaseOrder } from '../src/models/store.model.js';
import { createDraft, releaseDraft } from '../src/services/production/orderRaise.service.js';
import { issueFabricRoll, bypassFabricIssueForOrder } from '../src/services/factory/fabricIssue.service.js';
import { placeRoll } from '../src/services/factory/rackSlots.service.js';
import { upcomingCuts } from '../src/services/production/verticalCut.service.js';
import { nextCode } from '../src/services/factory/ids.js';

const ROLL_COUNT = 4;
const RACK_CODE = 'VC-DEMO';
const ORDER_QTY = 200;

function silenceMongoUrlWarning() {
  const { emitWarning } = process;
  process.emitWarning = (warning, ...args) => {
    if (args[0] === 'DeprecationWarning' && args[1] === 'DEP0170') return undefined;
    if (typeof warning === 'object' && warning?.code === 'DEP0170') return undefined;
    return emitWarning.call(process, warning, ...args);
  };
}

/**
 * @param {import('mongoose').Document | null} product
 */
function fabricFromProduct(product) {
  const row = (product?.bom || []).find((line) => line.fabricCatalogId || line.fabricName);
  if (!row) return null;
  const fabricCatalogId = String(row.fabricCatalogId?._id || row.fabricCatalogId || '');
  return {
    bomLineId: String(row.bomLineId || row._id || 'bom-1'),
    fabricCatalogId,
    fabricName: row.fabricName || 'Demo fabric',
    metresPerPiece: Number(row.quantity) || 0.1,
  };
}

/**
 * @param {string} fabricId
 * @param {string} fabricName
 */
async function ensureRack() {
  let rack = await StorageRack.findOne({ code: RACK_CODE });
  if (!rack) {
    rack = await StorageRack.create({
      code: RACK_CODE,
      barcode: `RACK-${RACK_CODE}`,
      name: 'Vertical cut demo rack',
      status: 'active',
    });
  }
  return rack.code;
}

/**
 * @param {object} fabric
 * @param {number} count
 */
async function createDemoRolls(fabric, count) {
  const po = await PurchaseOrder.create({
    number: nextCode('PO'),
    supplierName: 'Vertical cut demo',
    status: 'Received',
    lines: [{ lineId: 'L1', fabricId: fabric.fabricCatalogId, fabricName: fabric.fabricName, quantity: 500 }],
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
    netWeight: 40,
    grossWeight: 42,
  });
  const barcodes = [];
  for (let index = 0; index < count; index += 1) {
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
    barcodes.push(barcode);
  }
  return { lot, barcodes };
}

async function pickProduct() {
  const byCode = await Product.findOne({ factoryCode: 'FC-D-120957' });
  if (byCode) return byCode;
  const byName = await Product.findOne({ articleName: /flow hanky/i });
  if (byName) return byName;
  return Product.findOne({ productionType: 'normal', bom: { $exists: true, $not: { $size: 0 } } });
}

async function main() {
  silenceMongoUrlWarning();
  if (cfg.env !== 'development') {
    throw new Error('This seed is for NODE_ENV=development only.');
  }
  await mongoose.connect(cfg.mongoose.url, cfg.mongoose.options);
  try {
    const product = await pickProduct();
    if (!product) throw new Error('No catalog item with fabric BOM found. Add an item first.');
    let fabric = fabricFromProduct(product);
    if (!fabric?.fabricCatalogId) {
      const catalog = await FabricCatalog.findOne({ name: /cambric/i });
      if (!catalog) throw new Error('Product has no fabric catalog on BOM and no Cambric in catalog.');
      fabric = {
        bomLineId: fabric?.bomLineId || 'bom-demo',
        fabricCatalogId: String(catalog.id),
        fabricName: catalog.name,
        metresPerPiece: fabric?.metresPerPiece || 0.1,
      };
    }

    const order = await createDraft(
      {
        buyer: 'Demo buyer',
        priority: 'Medium',
        orderNote: 'Vertical cut demo seed',
        lines: [
          {
            itemId: String(product.id),
            quantity: ORDER_QTY,
            priority: 'Medium',
            piecesPerCut: 3,
            remarks: 'seed',
          },
        ],
      },
      null
    );
    const released = await releaseDraft(order.id, { confirm: true }, null);
    const line = released.lines[0];
    const lineId = String(line.id || line._id);
    const bomLine = released.lines[0].snapshot?.fabricBom?.[0] || fabric;

    const rackCode = await ensureRack();
    const { barcodes } = await createDemoRolls(fabric, ROLL_COUNT);
    for (const barcode of barcodes) {
      await placeRoll({ rollBarcode: barcode, rackCode, eventId: `seed-rack-${barcode}` }, null);
    }

    const issued = [];
    for (const barcode of barcodes) {
      const movement = await issueFabricRoll(
        {
          orderId: String(released.id),
          lineId,
          bomLineId: String(bomLine.bomLineId || fabric.bomLineId),
          rollBarcode: barcode,
          eventId: `seed-issue-${barcode}`,
        },
        null
      );
      issued.push({ barcode, metres: movement.qtyMeters });
    }
    await bypassFabricIssueForOrder(String(released.id), null);

    const upcoming = await upcomingCuts();
    const forOrder = (upcoming.results || []).filter((row) => String(row.orderId) === String(released.id));

    console.log('\n--- Vertical cut demo ready ---');
    console.log(`Order: ${released.orderNumber} (${released.id})`);
    console.log(`Article: ${line.factoryCode || line.articleName} · qty ${line.quantity}`);
    console.log(`Fabric: ${fabric.fabricName}`);
    console.log(`Issued rolls (${issued.length}):`);
    issued.forEach((row) => console.log(`  ${row.barcode} · ${row.metres} m`));
    console.log(`Rack used: ${rackCode}`);
    console.log(`Upcoming at vertical cutting: ${forOrder.length} roll(s)`);
    forOrder.forEach((row) => console.log(`  ${row.rollBarcode} · ${row.orderNumber} · ${row.qtyMeters} m`));
    console.log('\nOpen: http://localhost:3000/production/floor/vertical-cutting/');
    console.log('Production orders: http://localhost:3000/production/orders/');
    if (!forOrder.length) {
      console.warn('WARNING: No rolls in upcoming. Check fabric match and issue movements.');
    }
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});