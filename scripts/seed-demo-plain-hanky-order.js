/**
 * Release order for HK-D-NORM-01 and issue dummy fabric rolls.
 *
 *   NODE_ENV=development npm run seed:demo-plain-hanky-order
 */
import mongoose from 'mongoose';
import cfg from '../src/config/config.js';
import Product from '../src/models/product.model.js';
import StorageRack from '../src/models/storageRack.model.js';
import { FabricLot, FabricRoll, GoodsReceipt, PurchaseOrder } from '../src/models/store.model.js';
import { createDraft, releaseDraft } from '../src/services/production/orderRaise.service.js';
import { issueFabricRoll, bypassFabricIssueForOrder } from '../src/services/factory/fabricIssue.service.js';
import { placeRoll } from '../src/services/factory/rackSlots.service.js';
import { upcomingCuts } from '../src/services/production/verticalCut.service.js';
import { nextCode } from '../src/services/factory/ids.js';

const FACTORY_CODE = 'HK-D-NORM-01';
const ROLL_COUNT = 4;
const RACK_CODE = 'DEMO-NORM-RACK';
const ORDER_QTY = 180;

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

async function ensureRack() {
  let rack = await StorageRack.findOne({ code: RACK_CODE });
  if (!rack) {
    rack = await StorageRack.create({
      code: RACK_CODE,
      barcode: RACK_CODE,
      name: 'Demo normal order rack',
      stockType: 'fabric',
      status: 'active',
    });
  }
  return rack.code;
}

async function createDemoRolls(fabric, count) {
  const po = await PurchaseOrder.create({
    number: nextCode('PO'),
    supplierName: 'Demo plain hanky supplier',
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
  return barcodes;
}

async function main() {
  if (cfg.env !== 'development') throw new Error('NODE_ENV=development only');
  await mongoose.connect(cfg.mongoose.url, cfg.mongoose.options);
  try {
    const product = await Product.findOne({ factoryCode: FACTORY_CODE });
    if (!product) throw new Error(`Item ${FACTORY_CODE} not found. Run seed:production-catalog-demo first.`);
    const fabric = fabricFromProduct(product);
    if (!fabric?.fabricCatalogId) throw new Error('Item has no fabric BOM line');

    const order = await createDraft(
      {
        buyer: 'Flow audit buyer',
        priority: 'High',
        orderNote: 'Demo Plain Hanky White — end-to-end test',
        lines: [
          {
            itemId: String(product.id),
            quantity: ORDER_QTY,
            priority: 'High',
            piecesPerCut: product.piecesPerCut || 3,
            remarks: 'audit',
          },
        ],
      },
      null
    );
    const released = await releaseDraft(order.id, { confirm: true }, null);
    const line = released.lines[0];
    const lineId = String(line.id || line._id);
    const bomLine = line.snapshot?.fabricBom?.[0] || fabric;

    const rackCode = await ensureRack();
    const barcodes = await createDemoRolls(fabric, ROLL_COUNT);
    for (const barcode of barcodes) {
      await placeRoll({ rollBarcode: barcode, rackCode, eventId: `norm-seed-rack-${barcode}` }, null);
    }

    for (const barcode of barcodes) {
      await issueFabricRoll(
        {
          orderId: String(released.id),
          lineId,
          bomLineId: String(bomLine.bomLineId || fabric.bomLineId),
          rollBarcode: barcode,
          eventId: `norm-seed-issue-${barcode}`,
        },
        null
      );
    }
    await bypassFabricIssueForOrder(String(released.id), null);

    const upcoming = await upcomingCuts();
    const forOrder = (upcoming.results || []).filter((row) => String(row.orderId) === String(released.id));

    console.log('\n=== Demo Plain Hanky White order ready ===');
    console.log(`Order: ${released.orderNumber} (${released.id})`);
    console.log(`Article: ${product.name} · qty ${line.quantity}`);
    console.log(`Floors on order (${(released.floors || []).length}):`);
    (released.floors || []).forEach((row, index) => {
      console.log(`  ${index + 1}. ${row.name} [${row.floor}]`);
    });
    console.log(`Fabric: ${fabric.fabricName}`);
    console.log(`Issued rolls: ${barcodes.join(', ')}`);
    console.log(`Vertical cutting upcoming: ${forOrder.length} roll(s)`);
    console.log('\nNext: http://localhost:3000/production/orders/ then vertical cutting');
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});