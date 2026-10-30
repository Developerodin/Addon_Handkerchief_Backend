import mongoose from 'mongoose';
import setupTestDB from '../utils/setupTestDB.js';
import { FabricLot, FabricRoll, GoodsReceipt, PurchaseOrder, StockMovement } from '../../src/models/store.model.js';
import { ProductionOrder } from '../../src/models/production.model.js';
import StorageRack from '../../src/models/storageRack.model.js';
import { updateProcessRoll } from '../../src/services/factory/processRolls.service.js';
import { ensureCurrentBalance, issueWholeBalance, returnRollBalance } from '../../src/services/factory/rollBalance.js';
import { returnFabricRoll, listFabricReturns } from '../../src/services/factory/fabricReturn.service.js';
import { buildRollTrack } from '../../src/services/factory/rollTrack.service.js';
import { listRolls } from '../../src/services/factory/rollQuery.service.js';

setupTestDB();

const USER = { id: new mongoose.Types.ObjectId().toString(), name: 'Store User', email: 'store@example.com' };
const RECEIVED = { grossWeight: 25, netWeight: 24, qtyMeters: 150 };

/**
 * PO, lot, and receipt that own the FB-10 rolls.
 */
async function seedReceipt() {
  const po = await PurchaseOrder.create({
    number: `PO-FB10-${new mongoose.Types.ObjectId().toString().slice(-6)}`,
    supplierName: 'Mill',
    status: 'Received',
    lines: [{ lineId: 'L1', fabricName: 'FB-10', quantity: 10 }],
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
 * One roll before it is weighed. Current starts at zero, same as a new process row.
 * @param {object} ctx
 * @param {number} seq
 * @param {object} [overrides]
 */
async function seedRoll(ctx, seq, overrides = {}) {
  return FabricRoll.create({
    barcode: `bc-${ctx.po.number}-${seq}`,
    rollCode: `ROLL-${ctx.po.number}-1-${seq}`,
    lotId: ctx.lot.id,
    grnId: ctx.grn.id,
    poId: ctx.po.id,
    fabricId: 'fb-10',
    fabricName: 'FB-10',
    scaleWeight: 0,
    grossWeight: 0,
    netWeight: 0,
    qtyMeters: 0,
    currentGrossWeight: 0,
    currentNetWeight: 0,
    currentQtyMeters: 0,
    status: 'received',
    ...overrides,
  });
}

/**
 * Saves the received balance the process screen would save.
 * @param {import('mongoose').Document} roll
 * @param {object} [weights]
 */
function weigh(roll, weights = RECEIVED) {
  return updateProcessRoll(roll.id, weights);
}

/**
 * Runs a call that must fail, and returns the error message.
 * @param {() => Promise<unknown>} run
 */
async function rejection(run) {
  try {
    await run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error('expected a rejection');
}

/**
 * Drops current fields the way a roll saved before this change looks in Mongo.
 * @param {import('mongoose').Document} roll
 */
async function stripCurrent(roll) {
  await FabricRoll.collection.updateOne(
    { _id: roll._id },
    { $unset: { currentGrossWeight: '', currentNetWeight: '', currentQtyMeters: '' } }
  );
  return FabricRoll.findById(roll.id);
}

describe('FB-10 roll balance', () => {
  test('ten rolls keep received and current equal until one is issued', async () => {
    const ctx = await seedReceipt();
    const rolls = [];
    for (let seq = 1; seq <= 10; seq += 1) {
      rolls.push(await weigh(await seedRoll(ctx, seq)));
    }

    rolls.forEach((roll) => {
      expect(roll).toMatchObject({ ...RECEIVED, currentGrossWeight: 25, currentNetWeight: 24, currentQtyMeters: 150, receivedLocked: false });
      expect(roll.scaleWeight).toBe(24);
    });

    const listed = await listRolls({ poId: ctx.po.id, limit: '20' });
    const net = listed.results.reduce((sum, roll) => sum + roll.currentNetWeight, 0);
    const gross = listed.results.reduce((sum, roll) => sum + roll.currentGrossWeight, 0);
    const meters = listed.results.reduce((sum, roll) => sum + roll.currentQtyMeters, 0);
    expect(listed.results).toHaveLength(10);
    expect(listed.results.every((roll) => roll.receivedLocked === false)).toBe(true);
    expect({ gross, net, meters }).toEqual({ gross: 250, net: 240, meters: 1500 });
  });

  test('issue takes the current balance and leaves received untouched', async () => {
    const ctx = await seedReceipt();
    const first = await FabricRoll.findById((await weigh(await seedRoll(ctx, 1))).id);
    await weigh(await seedRoll(ctx, 2));

    const movement = await issueWholeBalance(first, { fromLocation: 'R-1', toLocation: 'floor' }, USER);
    const issued = await FabricRoll.findById(first.id);
    const sibling = await FabricRoll.findOne({ barcode: `bc-${ctx.po.number}-2` });

    expect(movement).toMatchObject({
      entityId: first.barcode,
      kind: 'issue',
      quantity: 1,
      grossWeight: 25,
      netWeight: 24,
      qtyMeters: 150,
      userName: 'Store User',
      fromLocation: 'R-1',
      toLocation: 'floor',
    });
    expect(issued).toMatchObject({ ...RECEIVED, currentGrossWeight: 0, currentNetWeight: 0, currentQtyMeters: 0, status: 'issued' });
    expect(sibling.currentNetWeight).toBe(24);
    expect(await rejection(() => issueWholeBalance(issued, { fromLocation: 'R-1', toLocation: 'floor' }, USER))).toBe('This roll has no balance left');
    expect(await StockMovement.countDocuments({ entityId: first.barcode, kind: 'issue' })).toBe(1);
  });

  test('return replaces current with the leftover and the next issue uses that leftover', async () => {
    const ctx = await seedReceipt();
    const roll = await FabricRoll.findById((await weigh(await seedRoll(ctx, 1))).id);
    await issueWholeBalance(roll, { fromLocation: 'R-1', toLocation: 'floor' }, USER);
    const issued = await FabricRoll.findById(roll.id);

    expect(await rejection(() => returnRollBalance(issued, { rackCode: 'R-2', grossWeight: 26, netWeight: 9, qtyMeters: 50 }, USER))).toBe('Leftover gross is above what was issued');
    expect(await rejection(() => returnRollBalance(issued, { rackCode: 'R-2', grossWeight: 10, netWeight: 25, qtyMeters: 50 }, USER))).toBe('Leftover net is above what was issued');
    expect(await rejection(() => returnRollBalance(issued, { rackCode: 'R-2', grossWeight: 10, netWeight: 9, qtyMeters: 151 }, USER))).toBe('Leftover meters are above what was issued');
    expect(await rejection(() => returnRollBalance(issued, { rackCode: 'R-2', grossWeight: 0, netWeight: 9, qtyMeters: 50 }, USER))).toBe('Leftover gross, net, and meters must be greater than 0');
    expect(await rejection(() => returnRollBalance(issued, { rackCode: '   ', grossWeight: 10, netWeight: 9, qtyMeters: 50 }, USER))).toBe('Rack is required');
    expect((await FabricRoll.findById(roll.id)).status).toBe('issued');
    expect(await StockMovement.countDocuments({ entityId: roll.barcode, kind: 'return-to-rack' })).toBe(0);

    const { movement } = await returnRollBalance(issued, { rackCode: '  R-2  ', grossWeight: 10, netWeight: 9, qtyMeters: 50 }, USER);
    const back = await FabricRoll.findById(roll.id);
    expect(movement.toLocation).toBe('R-2');
    expect(movement).toMatchObject({ kind: 'return-to-rack', grossWeight: 10, netWeight: 9, qtyMeters: 50, userName: 'Store User', fromLocation: 'floor' });
    expect(back).toMatchObject({ ...RECEIVED, currentGrossWeight: 10, currentNetWeight: 9, currentQtyMeters: 50, status: 'stored' });

    const second = await issueWholeBalance(back, { fromLocation: 'R-2', toLocation: 'floor' }, USER);
    expect(second).toMatchObject({ grossWeight: 10, netWeight: 9, qtyMeters: 50 });
    const again = await FabricRoll.findById(roll.id);
    expect(again).toMatchObject({ ...RECEIVED, currentGrossWeight: 0, currentNetWeight: 0, currentQtyMeters: 0, status: 'issued' });

    expect(await rejection(() => returnRollBalance(again, { rackCode: 'R-3', grossWeight: 11, netWeight: 8, qtyMeters: 40 }, USER))).toBe('Leftover gross is above what was issued');
    await returnRollBalance(again, { rackCode: 'R-3', grossWeight: 10.0004, netWeight: 8, qtyMeters: 40 }, USER);
    const finalRoll = await FabricRoll.findById(roll.id);
    expect(finalRoll).toMatchObject({ grossWeight: 25, netWeight: 24, qtyMeters: 150, currentGrossWeight: 10, currentNetWeight: 8, currentQtyMeters: 40 });
  });

  test('received weights lock after the first issue and stay locked once the leftover is back', async () => {
    const ctx = await seedReceipt();
    const roll = await FabricRoll.findById((await weigh(await seedRoll(ctx, 1))).id);
    const edited = await updateProcessRoll(roll.id, { grossWeight: 25, netWeight: 24, qtyMeters: 140 });
    expect(edited).toMatchObject({ qtyMeters: 140, currentQtyMeters: 140, receivedLocked: false });

    await issueWholeBalance(await FabricRoll.findById(roll.id), { fromLocation: 'R-1', toLocation: 'floor' }, USER);
    expect(await rejection(() => updateProcessRoll(roll.id, { qtyMeters: 10 }))).toBe('Received weight is locked after this roll is issued');

    await returnRollBalance(await FabricRoll.findById(roll.id), { rackCode: 'R-2', grossWeight: 10, netWeight: 9, qtyMeters: 50 }, USER);
    expect(await rejection(() => updateProcessRoll(roll.id, { netWeight: 1 }))).toBe('Received weight is locked after this roll is issued');
    const listed = await listRolls({ poId: ctx.po.id, limit: '20' });
    expect(listed.results[0]).toMatchObject({ receivedLocked: true, netWeight: 24, currentNetWeight: 9, qtyMeters: 140, currentQtyMeters: 50 });
  });

  test('a roll that never left the rack cannot be returned', async () => {
    const ctx = await seedReceipt();
    const roll = await FabricRoll.findById((await weigh(await seedRoll(ctx, 1))).id);
    expect(await rejection(() => returnRollBalance(roll, { rackCode: 'R-1', ...RECEIVED }, USER))).toBe('This roll is not issued');
    const empty = await seedRoll(ctx, 2);
    expect(await rejection(() => issueWholeBalance(empty, { fromLocation: 'R-1', toLocation: 'floor' }, USER))).toBe('This roll has no balance left');
  });

  test('rounding and a full leftover equal to the issue are accepted', async () => {
    const ctx = await seedReceipt();
    const saved = await weigh(await seedRoll(ctx, 1), { grossWeight: 25.23456, netWeight: 24.23444, qtyMeters: 150.2346 });
    expect(saved).toMatchObject({ grossWeight: 25.235, netWeight: 24.234, qtyMeters: 150.235, currentGrossWeight: 25.235, currentNetWeight: 24.234, currentQtyMeters: 150.235 });

    const roll = await FabricRoll.findById(saved.id);
    await issueWholeBalance(roll, { fromLocation: 'R-1', toLocation: 'floor' }, USER);
    await returnRollBalance(await FabricRoll.findById(roll.id), { rackCode: 'R-1', grossWeight: 25.2346, netWeight: 24.2344, qtyMeters: 150.2346 }, USER);
    expect(await FabricRoll.findById(roll.id)).toMatchObject({ currentGrossWeight: 25.235, currentNetWeight: 24.234, currentQtyMeters: 150.235, status: 'stored' });
  });

  test('a later rack scan does not close the open issue, and on-floor can come back', async () => {
    const ctx = await seedReceipt();
    const roll = await FabricRoll.findById((await weigh(await seedRoll(ctx, 1))).id);
    await issueWholeBalance(roll, { fromLocation: 'R-1', toLocation: 'floor' }, USER);
    await StockMovement.create({
      entityType: 'roll',
      entityId: roll.barcode,
      kind: 'rack',
      toLocation: 'TEMP',
      quantity: 1,
    });
    await FabricRoll.updateOne({ _id: roll.id }, { status: 'on-floor' });
    await returnRollBalance(await FabricRoll.findById(roll.id), { rackCode: 'R-9', grossWeight: 12, netWeight: 11, qtyMeters: 70 }, USER);
    const back = await FabricRoll.findById(roll.id);
    expect(back).toMatchObject({ status: 'stored', currentGrossWeight: 12, currentNetWeight: 11, currentQtyMeters: 70, grossWeight: 25 });

    const track = await buildRollTrack(roll.rollCode);
    expect(track.openIssue).toBeNull();
    expect(track.roll).toMatchObject({ currentNetWeight: 11, qtyMeters: 150 });
    const issuedEvent = track.timeline.find((event) => event.title === 'Issued');
    expect(issuedEvent.details).toMatchObject({ 'Gross (kg)': 25, 'Net (kg)': 24, Meters: 150, User: 'Store User' });
  });

  test('old rolls without a current balance pick it up from received, or zero when already issued', async () => {
    const ctx = await seedReceipt();
    const stored = await stripCurrent(await seedRoll(ctx, 1, { ...RECEIVED, scaleWeight: 24, status: 'stored' }));
    expect(stored.currentNetWeight == null).toBe(true);
    await ensureCurrentBalance(stored);
    expect(await FabricRoll.findById(stored.id)).toMatchObject({ ...RECEIVED, currentGrossWeight: 25, currentNetWeight: 24, currentQtyMeters: 150 });

    const issued = await stripCurrent(await seedRoll(ctx, 2, { ...RECEIVED, scaleWeight: 24, status: 'issued' }));
    await ensureCurrentBalance(issued);
    expect(await FabricRoll.findById(issued.id)).toMatchObject({ ...RECEIVED, currentGrossWeight: 0, currentNetWeight: 0, currentQtyMeters: 0 });
  });

  test('old issue rows with no meters follow the received cap, and unmeasured rolls accept a typed leftover', async () => {
    const ctx = await seedReceipt();
    const measured = await seedRoll(ctx, 1, { ...RECEIVED, scaleWeight: 24, status: 'issued', currentGrossWeight: 0, currentNetWeight: 0, currentQtyMeters: 0 });
    await StockMovement.create({
      entityType: 'roll',
      entityId: measured.barcode,
      kind: 'issue',
      toLocation: 'floor',
      quantity: 1,
      netWeight: 24,
      userName: 'Old User',
    });
    expect(await rejection(() => returnRollBalance(measured, { rackCode: 'R-1', grossWeight: 25, netWeight: 24, qtyMeters: 151 }, USER))).toBe('Leftover meters are above what was issued');
    await returnRollBalance(await FabricRoll.findById(measured.id), { rackCode: 'R-1', grossWeight: 25, netWeight: 24, qtyMeters: 150 }, USER);
    expect(await FabricRoll.findById(measured.id)).toMatchObject({ currentQtyMeters: 150, qtyMeters: 150 });

    const blank = await seedRoll(ctx, 2, { grossWeight: 25, netWeight: 24, qtyMeters: 0, scaleWeight: 24, status: 'issued', currentGrossWeight: 0, currentNetWeight: 0, currentQtyMeters: 0 });
    await StockMovement.create({
      entityType: 'roll',
      entityId: blank.barcode,
      kind: 'issue',
      toLocation: 'floor',
      quantity: 1,
      netWeight: 24,
      grossWeight: 25,
    });
    await returnRollBalance(blank, { rackCode: 'R-4', grossWeight: 8, netWeight: 7, qtyMeters: 33 }, USER);
    expect(await FabricRoll.findById(blank.id)).toMatchObject({ qtyMeters: 0, currentQtyMeters: 33, currentNetWeight: 7, netWeight: 24 });
  });

  test('a vendor return stays view only', async () => {
    const ctx = await seedReceipt();
    const roll = await seedRoll(ctx, 1, { status: 'returned-to-vendor', ...RECEIVED, scaleWeight: 24 });
    expect(await rejection(() => updateProcessRoll(roll.id, RECEIVED))).toBe('This roll was returned and is view only');
  });

  test('a return for this order stamps the article and the scanned rack', async () => {
    const ctx = await seedReceipt();
    const productId = new mongoose.Types.ObjectId();
    const order = await ProductionOrder.create({
      orderNumber: `ORD-${ctx.po.number}`,
      productionType: 'normal',
      targetQty: 10,
      lines: [{
        itemId: productId,
        articleName: 'Hanky',
        factoryCode: 'HK',
        productionType: 'normal',
        quantity: 10,
        snapshot: { fabricBom: [{ bomLineId: 'fb-10', fabricCatalogId: 'fb-10', fabricName: 'FB-10', metresPerPiece: 0.2 }] },
      }],
    });
    const other = await ProductionOrder.create({
      orderNumber: `ORD-OTHER-${ctx.po.number}`,
      productionType: 'normal',
      targetQty: 10,
      lines: [{
        itemId: productId,
        articleName: 'Other',
        factoryCode: 'OT',
        productionType: 'normal',
        quantity: 10,
        snapshot: { fabricBom: [{ bomLineId: 'fb-10', fabricCatalogId: 'fb-10', fabricName: 'FB-10', metresPerPiece: 0.2 }] },
      }],
    });
    const lineId = String(order.lines[0].id);
    const roll = await FabricRoll.findById((await weigh(await seedRoll(ctx, 1, { fabricId: 'fb-10' }))).id);
    await issueWholeBalance(roll, { fromLocation: 'R-1', toLocation: 'floor', orderId: order.id, lineId, bomLineId: 'fb-10', fabricName: 'FB-10' }, USER);
    await StorageRack.create({ code: 'A1', name: 'Aisle 1', barcode: `RACK-${ctx.po.number}`, stockType: 'fabric' });

    const issued = await FabricRoll.findById(roll.id);
    expect(await rejection(() => returnFabricRoll({
      rollBarcode: roll.barcode,
      orderId: other.id,
      lineId: String(other.lines[0].id),
      bomLineId: 'fb-10',
      rackCode: `RACK-${ctx.po.number}`,
      grossWeight: 10,
      netWeight: 9,
      qtyMeters: 50,
    }, USER))).toBe('This roll was issued to another order');
    expect(await rejection(() => returnFabricRoll({
      rollBarcode: roll.barcode,
      orderId: order.id,
      lineId,
      bomLineId: 'fb-10',
      rackCode: 'MISSING-RACK',
      grossWeight: 10,
      netWeight: 9,
      qtyMeters: 50,
    }, USER))).toBe('Rack not found. Scan a rack barcode that exists.');

    const movement = await returnFabricRoll({
      rollBarcode: roll.barcode,
      orderId: order.id,
      lineId,
      bomLineId: 'fb-10',
      rackCode: `RACK-${ctx.po.number}`,
      grossWeight: 10,
      netWeight: 9,
      qtyMeters: 50,
    }, USER);
    expect(movement).toMatchObject({
      orderId: order._id,
      lineId,
      bomLineId: 'fb-10',
      fabricName: 'FB-10',
      toLocation: 'A1',
      grossWeight: 10,
      netWeight: 9,
      qtyMeters: 50,
      userName: 'Store User',
    });
    expect(issued.status).toBe('issued');
    const listed = await listFabricReturns({ orderId: order.id });
    expect(listed.results[0]).toMatchObject({
      orderNumber: order.orderNumber,
      factoryCode: 'HK',
      articleName: 'Hanky',
      rackCode: 'A1',
      barcode: roll.barcode,
      userName: 'Store User',
    });
  });
});
