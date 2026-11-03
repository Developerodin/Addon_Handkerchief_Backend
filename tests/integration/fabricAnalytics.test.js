import mongoose from 'mongoose';
import setupTestDB from '../utils/setupTestDB.js';
import { FabricLot, FabricRoll, GoodsReceipt, PurchaseOrder, StockMovement } from '../../src/models/store.model.js';
import FabricCatalog from '../../src/models/fabricCatalog.model.js';
import { fabricAnalytics, latestLocationPipeline } from '../../src/services/factory/fabricAnalytics.service.js';

setupTestDB();

/**
 * Purchase order, lot, and receipt that own the seeded rolls.
 */
async function seedReceipt() {
  const po = await PurchaseOrder.create({
    number: `PO-FAB-${new mongoose.Types.ObjectId().toString().slice(-6)}`,
    supplierName: 'Mill',
    status: 'Received',
    lines: [{ lineId: 'L1', fabricName: 'Cambric', quantity: 10 }],
  });
  const lot = await FabricLot.create({ poId: po.id, status: 'approved', qcStatus: 'passed' });
  const grn = await GoodsReceipt.create({
    number: `GRN-${po.number}`,
    lotId: lot.id,
    poId: po.id,
  });
  return { po, lot, grn };
}

/**
 * One roll on the shared receipt.
 * @param {Awaited<ReturnType<typeof seedReceipt>>} ctx
 * @param {import('mongoose').Document} catalog
 * @param {object} overrides
 */
function addRoll(ctx, catalog, overrides) {
  return FabricRoll.create({
    barcode: `bc-${new mongoose.Types.ObjectId().toString()}`,
    lotId: ctx.lot.id,
    grnId: ctx.grn.id,
    poId: ctx.po.id,
    fabricId: String(catalog._id),
    fabricName: catalog.name,
    colourName: catalog.colourName,
    scaleWeight: 1,
    ...overrides,
  });
}

/**
 * Puts two movements on a roll. The later one is the location the report must use.
 * @param {string} barcode
 * @param {string} older
 * @param {string} latest
 */
async function place(barcode, older, latest) {
  await StockMovement.create({ entityType: 'roll', entityId: barcode, kind: 'rack', toLocation: older });
  await StockMovement.create({ entityType: 'roll', entityId: barcode, kind: 'rack', toLocation: latest });
}

/**
 * Cambric has stock, an open balance, and two drafts. Poplin is an empty catalog row.
 * @param {Awaited<ReturnType<typeof seedReceipt>>} ctx
 */
async function seedFabrics(ctx) {
  const cambric = await FabricCatalog.create({
    name: 'Cambric',
    colourName: 'White',
    fabricSortNo: 'C-1',
  });
  const poplin = await FabricCatalog.create({
    name: 'Poplin',
    colourName: 'Blue',
    fabricSortNo: 'P-9',
  });

  const onRack = await addRoll(ctx, cambric, { status: 'stored', currentQtyMeters: 40, qtyMeters: 40 });
  const otherRack = await addRoll(ctx, cambric, { status: 'stored', currentQtyMeters: 10, qtyMeters: 10 });
  const offRack = await addRoll(ctx, cambric, { status: 'stored', currentQtyMeters: 5, qtyMeters: 5 });
  await place(onRack.barcode, 'OLD-1', 'A-1');
  await place(otherRack.barcode, 'OLD-2', 'B-2');
  await place(offRack.barcode, 'A-9', 'floor');
  await addRoll(ctx, cambric, { status: 'qc-passed', qtyMeters: 15 });
  await addRoll(ctx, cambric, { status: 'received', currentQtyMeters: 25, qtyMeters: 25 });
  await addRoll(ctx, cambric, { status: 'lot-held', currentQtyMeters: 9 });
  await addRoll(ctx, cambric, { status: 'issued', currentQtyMeters: 100 });
  await addRoll(ctx, cambric, { status: 'returned', currentQtyMeters: 12 });

  await PurchaseOrder.create({
    number: `PO-OPEN-${new mongoose.Types.ObjectId().toString().slice(-6)}`,
    supplierName: 'Mill',
    status: 'Partially Received',
    lines: [
      {
        lineId: 'OPEN-1',
        fabricId: cambric._id,
        fabricName: 'Cambric',
        colourName: 'White',
        fabricSortNo: 'C-1',
        quantity: 100,
      },
    ],
    receivedLots: [{ lotNumber: 'IN-1', lines: [{ lineId: 'OPEN-1', receivedQuantity: 30 }] }],
  });
  await PurchaseOrder.create({
    number: `PO-DRAFT-A-${new mongoose.Types.ObjectId().toString().slice(-6)}`,
    supplierName: 'Mill',
    status: 'Draft',
    lines: [{ lineId: 'D1', fabricId: cambric._id, fabricName: 'Cambric', quantity: 12 }],
  });
  await PurchaseOrder.create({
    number: `PO-DRAFT-B-${new mongoose.Types.ObjectId().toString().slice(-6)}`,
    supplierName: 'Mill',
    status: 'Draft',
    lines: [
      { lineId: 'D2', fabricId: cambric._id, fabricName: 'Cambric', quantity: 8 },
      { lineId: 'D3', fabricName: 'Mill seconds', colourName: 'Grey', quantity: 4 },
    ],
  });
  await PurchaseOrder.create({
    number: `PO-DONE-${new mongoose.Types.ObjectId().toString().slice(-6)}`,
    supplierName: 'Mill',
    status: 'Completed',
    lines: [{ lineId: 'DONE', fabricId: cambric._id, fabricName: 'Cambric', quantity: 500 }],
  });

  return { cambric, poplin };
}

describe('fabric analytics report', () => {
  test('inventory, open orders, drafts, and racks stay on the same fabric', async () => {
    const seeded = await seedFabrics(await seedReceipt());
    const report = await fabricAnalytics({ page: 1, limit: 20, sortBy: 'fabricName', sortOrder: 'asc' });
    const cambric = report.results.find((row) => row.fabricName === 'Cambric');
    const poplin = report.results.find((row) => row.fabricName === 'Poplin');
    const orphan = report.results.find((row) => row.fabricName === 'Mill seconds');

    expect(report.results.map((row) => row.fabricName)).toEqual(['Cambric', 'Mill seconds', 'Poplin']);
    expect(cambric).toMatchObject({
      fabricId: String(seeded.cambric._id),
      colourName: 'White',
      fabricSortNo: 'C-1',
      inventoryMeters: 104,
      inOrderMeters: 70,
      draftMeters: 20,
      draftPoCount: 2,
      unallocatedMeters: 25,
      onRackMeters: 55,
      racks: [
        { code: 'A-1', meters: 40 },
        { code: 'B-2', meters: 10 },
      ],
    });
    expect(poplin).toMatchObject({
      fabricId: String(seeded.poplin._id),
      inventoryMeters: 0,
      inOrderMeters: 0,
      draftMeters: 0,
      draftPoCount: 0,
      unallocatedMeters: 0,
      onRackMeters: 0,
      racks: [],
    });
    expect(orphan).toMatchObject({
      fabricId: '',
      colourName: 'Grey',
      draftMeters: 4,
      draftPoCount: 1,
      inventoryMeters: 0,
    });
    expect(report.summary).toEqual({
      fabricCount: 3,
      inventoryMeters: 104,
      inOrderMeters: 70,
      draftMeters: 24,
      draftPoCount: 2,
      unallocatedMeters: 25,
      onRackMeters: 55,
    });
  });

  test('search and paging keep the summary on the full match', async () => {
    await seedFabrics(await seedReceipt());
    const searched = await fabricAnalytics({ search: 'white', page: 1, limit: 20 });
    expect(searched.results.map((row) => row.fabricName)).toEqual(['Cambric']);
    expect(searched.summary).toMatchObject({ fabricCount: 1, inventoryMeters: 104, draftPoCount: 2 });

    const page = await fabricAnalytics({ page: 2, limit: 1, sortBy: 'fabricName', sortOrder: 'asc' });
    expect(page.results.map((row) => row.fabricName)).toEqual(['Mill seconds']);
    expect(page.totalPages).toBe(3);
    expect(page.totalResults).toBe(3);
    expect(page.summary.fabricCount).toBe(3);
    expect(page.summary.draftMeters).toBe(24);
  });

  test('latest rack lookup uses the movement index', async () => {
    await StockMovement.syncIndexes();
    await StockMovement.create({ entityType: 'roll', entityId: 'bc-index', kind: 'rack', toLocation: 'A-1' });
    const explained = await StockMovement.aggregate(latestLocationPipeline(['bc-index'])).explain('queryPlanner');
    expect(JSON.stringify(explained)).toContain('entityType_1_entityId_1_createdAt_-1');
  });
});
