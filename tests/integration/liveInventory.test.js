import mongoose from 'mongoose';
import setupTestDB from '../utils/setupTestDB.js';
import { FabricLot, FabricRoll, GoodsReceipt, PurchaseOrder } from '../../src/models/store.model.js';
import FabricCatalog from '../../src/models/fabricCatalog.model.js';
import { liveInventory, liveInventoryCsv, unallocatedRolls } from '../../src/services/factory/liveInventory.service.js';

setupTestDB();

/**
 * Purchase order, lot, and receipt that own the seeded rolls.
 */
async function seedReceipt() {
  const po = await PurchaseOrder.create({
    number: `PO-LIVE-${new mongoose.Types.ObjectId().toString().slice(-6)}`,
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
 * Cambric is low, Poplin is in stock, Voile is out, and a returned-only fabric is excluded.
 * @param {Awaited<ReturnType<typeof seedReceipt>>} ctx
 */
async function seedFabrics(ctx) {
  const low = await FabricCatalog.create({
    name: 'Cambric',
    colourName: 'White',
    fabricSortNo: 'C-1',
    minQuantity: 100,
  });
  const stocked = await FabricCatalog.create({
    name: 'Poplin',
    colourName: 'Blue',
    fabricSortNo: 'P-9',
    minQuantity: 10,
  });
  const gone = await FabricCatalog.create({
    name: 'Voile',
    colourName: 'Red',
    fabricSortNo: 'V-2',
    minQuantity: 5,
  });
  const returned = await FabricCatalog.create({ name: 'Returned only', minQuantity: 50 });

  await addRoll(ctx, low, { status: 'stored', currentQtyMeters: 40, qtyMeters: 40 });
  await addRoll(ctx, low, { status: 'qc-passed', qtyMeters: 15 });
  await addRoll(ctx, low, {
    status: 'received',
    currentQtyMeters: 25,
    qtyMeters: 25,
    receivedLotNumber: 'LOT-9',
    currentNetWeight: 3.5,
  });
  await addRoll(ctx, low, { status: 'issued', currentQtyMeters: 100 });
  await addRoll(ctx, low, { status: 'on-floor', currentQtyMeters: 8 });
  await addRoll(ctx, low, { status: 'lot-held', currentQtyMeters: 9 });
  await addRoll(ctx, low, { status: 'returned', currentQtyMeters: 12 });
  await addRoll(ctx, low, { status: 'returned-to-vendor', currentQtyMeters: 7 });
  await addRoll(ctx, stocked, { status: 'stored', currentQtyMeters: 200 });
  await addRoll(ctx, gone, { status: 'issued', currentQtyMeters: 30 });
  await addRoll(ctx, returned, { status: 'returned', currentQtyMeters: 80 });

  return { low, stocked, gone, poNumber: ctx.po.number };
}

describe('live inventory report', () => {
  test('available is stored plus QC passed, and issued is not subtracted', async () => {
    const seeded = await seedFabrics(await seedReceipt());
    const report = await liveInventory({ page: 1, limit: 20, sortBy: 'fabricName', sortOrder: 'asc' });
    const cambric = report.results.find((row) => row.fabricName === 'Cambric');

    expect(report.totalResults).toBe(3);
    expect(report.results.map((row) => row.fabricName)).toEqual(['Cambric', 'Poplin', 'Voile']);
    expect(cambric).toMatchObject({
      fabricId: String(seeded.low._id),
      colourName: 'White',
      fabricSortNo: 'C-1',
      onRackMeters: 40,
      qcPassedMeters: 15,
      unallocatedMeters: 25,
      rollCount: 2,
      issuedMeters: 108,
      heldMeters: 9,
      availableMeters: 55,
      minQuantity: 100,
      status: 'Low Stock',
    });
    expect(report.results.find((row) => row.fabricName === 'Poplin').status).toBe('In Stock');
    expect(report.results.find((row) => row.fabricName === 'Voile')).toMatchObject({
      availableMeters: 0,
      issuedMeters: 30,
      status: 'Out of Stock',
    });
    expect(report.summary).toEqual({
      skuCount: 3,
      lowStockCount: 1,
      onRackMeters: 240,
      qcPassedMeters: 15,
      unallocatedMeters: 25,
      issuedMeters: 138,
      heldMeters: 9,
      availableMeters: 255,
    });
  });

  test('pagination and filters keep the summary on the full match, not the page', async () => {
    await seedFabrics(await seedReceipt());
    const page = await liveInventory({ page: 2, limit: 2, sortBy: 'availableMeters', sortOrder: 'desc' });

    expect(page.results).toHaveLength(1);
    expect(page.results[0].fabricName).toBe('Voile');
    expect(page.totalPages).toBe(2);
    expect(page.totalResults).toBe(3);
    expect(page.summary.availableMeters).toBe(255);

    const low = await liveInventory({ status: 'Low Stock', search: 'white' });
    expect(low.results).toHaveLength(1);
    expect(low.results[0].fabricName).toBe('Cambric');
    expect(low.summary.skuCount).toBe(1);
    expect(low.summary.availableMeters).toBe(55);

    const colour = await liveInventory({ search: 'P-9' });
    expect(colour.results.map((row) => row.fabricName)).toEqual(['Poplin']);
  });

  test('unallocated drill-down and csv stay on the same buckets', async () => {
    const seeded = await seedFabrics(await seedReceipt());
    const drawer = await unallocatedRolls({ fabricId: String(seeded.low._id), page: 1, limit: 50 });

    expect(drawer.totalResults).toBe(1);
    expect(drawer.results[0]).toMatchObject({
      lot: 'LOT-9',
      poNumber: seeded.poNumber,
      meters: 25,
      netKg: 3.5,
    });

    const csv = await liveInventoryCsv({ status: 'Out of Stock' });
    expect(csv).toContain('Fabric,Colour,Sort');
    expect(csv).toContain('Voile');
    expect(csv).not.toContain('Cambric');
    expect(csv).not.toContain('Returned only');
  });
});
