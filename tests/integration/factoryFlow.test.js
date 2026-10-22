import mongoose from 'mongoose';
import request from 'supertest';
import httpStatus from 'http-status';
import app from '../utils/factoryTestApp';
import setupTestDB from '../utils/setupTestDB';
import { insertUsers, admin } from '../fixtures/user.fixture';
import { adminAccessToken } from '../fixtures/token.fixture';
import { tokenTypes } from '../../src/config/tokens.js';
import { generateToken } from '../../src/services/token.service.js';
import moment from 'moment';
import config from '../../src/config/config.js';
import { getDefaultNavigationByRole } from '../../src/utils/navigationHelper.js';
import { accessPreset } from '../../src/services/accessPresets.js';
import FabricCatalog from '../../src/models/fabricCatalog.model.js';
import Category from '../../src/models/category.model.js';
import Process from '../../src/models/process.model.js';
import Product from '../../src/models/product.model.js';
import { PurchaseOrder } from '../../src/models/store.model.js';
import { ProductionOrder } from '../../src/models/production.model.js';
import { VersionPin } from '../../src/models/versioning.model.js';
import { publishItemDefinition } from '../../src/services/catalogPublish.service.js';
import { QualityResult } from '../../src/models/quality.model.js';
import { SalesInvoice } from '../../src/models/invoice.model.js';

setupTestDB();

const api = request(app);
const superId = new mongoose.Types.ObjectId();
const superToken = generateToken(
  superId,
  moment().add(config.jwt.accessExpirationMinutes, 'minutes'),
  tokenTypes.ACCESS
);
const auth = { Authorization: `Bearer ${superToken}` };

beforeEach(async () => {
  await insertUsers([
    { ...admin, navigation: getDefaultNavigationByRole('admin') },
    {
      _id: superId,
      name: 'Super',
      email: 'factory-super@addon.test',
      password: 'password1',
      role: 'super_admin',
      navigation: getDefaultNavigationByRole('super_admin'),
    },
  ]);
});

describe('Factory flow', () => {
  test('admin is refused and superadmin can read sync', async () => {
    await api.get('/v1/sync/status').set('Authorization', `Bearer ${adminAccessToken}`).expect(httpStatus.FORBIDDEN);
    const status = await api.get('/v1/sync/status').set(auth).expect(httpStatus.OK);
    expect(status.body.schemaVersion).toBe(1);
  });

  test(
    'store, qc, production, warehouse, invoice, and sync rules',
    async () => {
    const fabric = await FabricCatalog.create({ name: 'Voile', rate: 10 });
    const poRes = await api
      .post('/v1/store/purchase-orders')
      .set(auth)
      .send({
        supplierName: 'Mill A',
        supplierAddress: 'Jaipur',
        supplierTerms: '30 days',
        lines: [{ lineId: 'L1', fabricId: String(fabric._id), fabricName: 'Voile', quantity: 100, rate: 10, gstPercent: 5 }],
      })
      .expect(httpStatus.CREATED);
    await api.post(`/v1/store/purchase-orders/${poRes.body.id}/submit`).set(auth).expect(httpStatus.OK);
    fabric.rate = 99;
    await fabric.save();
    const frozen = await PurchaseOrder.findById(poRes.body.id);
    expect(frozen.lines[0].rate).toBe(10);
    expect(frozen.lines[0].gstPercent).toBe(5);
    await api
      .patch(`/v1/store/purchase-orders/${poRes.body.id}/commercials`)
      .set(auth)
      .send({ lineId: 'L1', rate: 80 })
      .expect(httpStatus.BAD_REQUEST);

    const lot = await api
      .post('/v1/store/lots')
      .set(auth)
      .send({ poId: poRes.body.id, cutoffs: [{ fabricId: String(fabric._id) }] })
      .expect(httpStatus.CREATED);
    await api
      .post(`/v1/store/lots/${lot.body.id}/cutoffs`)
      .set(auth)
      .send({ decisions: [{ fabricId: String(fabric._id), approved: false }] })
      .expect(httpStatus.OK);
    await api
      .post('/v1/store/receipts')
      .set(auth)
      .send({ lotId: lot.body.id, rolls: [{ scaleWeight: 12 }] })
      .expect(httpStatus.BAD_REQUEST);

    await api
      .post(`/v1/store/lots/${lot.body.id}/cutoffs`)
      .set(auth)
      .send({ decisions: [{ fabricId: String(fabric._id), approved: true }] })
      .expect(httpStatus.OK);
    await api
      .post('/v1/store/receipts')
      .set(auth)
      .send({ lotId: lot.body.id, rolls: [{ scaleWeight: 12.4 }] })
      .expect(httpStatus.BAD_REQUEST);
    await api
      .post('/v1/store/packing-lists')
      .set(auth)
      .send({
        lotId: lot.body.id,
        packingListCode: 'PL-1',
        shipmentDate: new Date().toISOString(),
        expectedDelivery: new Date().toISOString(),
        fabricName: 'Voile',
        rolls: 1,
        quantity: 100,
        weight: 12,
      })
      .expect(httpStatus.CREATED);
    const receipt = await api
      .post('/v1/store/receipts')
      .set(auth)
      .send({
        lotId: lot.body.id,
        eventId: 'grn-1',
        netWeight: 12,
        grossWeight: 13,
        rolls: [{ scaleWeight: 12.4, fabricId: String(fabric._id) }],
      })
      .expect(httpStatus.CREATED);
    const again = await api
      .post('/v1/store/receipts')
      .set(auth)
      .send({ lotId: lot.body.id, eventId: 'grn-1', rolls: [{ scaleWeight: 1 }] })
      .expect(httpStatus.CREATED);
    expect(again.body.rolls).toHaveLength(1);
    expect(again.body.rolls[0].barcode).toBe(receipt.body.rolls[0].barcode);
    expect(receipt.body.rolls[0].rate).toBe(10);

    const barcode = receipt.body.rolls[0].barcode;
    await api.post('/v1/store/racks').set(auth).send({ rollBarcode: barcode, rackCode: 'B1' }).expect(httpStatus.CREATED);
    expect((await api.get('/v1/store/racks/B1/occupancy').set(auth)).body.count).toBe(1);
    await api.post('/v1/store/racks').set(auth).send({ rollBarcode: barcode, rackCode: 'B2' }).expect(httpStatus.CREATED);
    expect((await api.get('/v1/store/racks/B1/occupancy').set(auth)).body.count).toBe(0);
    expect((await api.get('/v1/store/racks/B2/occupancy').set(auth)).body.count).toBe(1);

    await api
      .post('/v1/quality/fabric-samples')
      .set(auth)
      .send({ eventId: 'sample-1', lotId: lot.body.id, rollBarcode: barcode, passed: false })
      .expect(httpStatus.CREATED);
    await api
      .post('/v1/store/issues')
      .set(auth)
      .send({ lotId: lot.body.id, rollBarcodes: [barcode] })
      .expect(httpStatus.BAD_REQUEST);

    const waiting = await api
      .post('/v1/sync/apply')
      .set(auth)
      .send({
        eventId: 'grn-before-po',
        entityType: 'grn',
        aggregateId: 'x',
        operation: 'receive',
        payload: { n: 1 },
        dependsOn: ['po-event-missing'],
      })
      .expect(httpStatus.OK);
    expect(waiting.body.status).toBe('WAITING_DEPENDENCY');

    const order = await api
      .post('/v1/production/orders')
      .set(auth)
      .send({ productionType: 'normal', revisionId: 'V5', targetQty: 1000 })
      .expect(httpStatus.CREATED);
    await api
      .post('/v1/production/completions')
      .set(auth)
      .send({ eventId: 'cut-1', orderId: order.body.id, stage: 'vertical-cut', qty: 400, site: 'factory' })
      .expect(httpStatus.CREATED);
    await api
      .post('/v1/production/completions')
      .set(auth)
      .send({ eventId: 'cut-1', orderId: order.body.id, stage: 'vertical-cut', qty: 400, site: 'factory' })
      .expect(httpStatus.CREATED);
    const pinned = await ProductionOrder.findById(order.body.id);
    expect(pinned.revisionId).toBe('V5');
    expect(pinned.segments[0].completedQty).toBe(400);

    const amended = await api
      .post(`/v1/production/orders/${order.body.id}/amend`)
      .set(auth)
      .send({ revisionId: 'V6', remainingQty: 600 })
      .expect(httpStatus.OK);
    expect(amended.body.segments[0].qty).toBe(400);
    expect(amended.body.segments[1].revisionId).toBe('V6');
    expect(amended.body.segments[1].qty).toBe(600);

    await api
      .post('/v1/production/completions')
      .set(auth)
      .send({ eventId: 'cloud-1', orderId: order.body.id, stage: 'hem', qty: 1, site: 'cloud' })
      .expect(httpStatus.FORBIDDEN);

    const pieces = await api
      .post('/v1/production/cuts')
      .set(auth)
      .send({ orderId: order.body.id, rollBarcode: barcode, pieceCount: 61 })
      .expect(httpStatus.CREATED);
    expect(pieces.body).toHaveLength(61);

    const partial = await api
      .post('/v1/production/bundles/close')
      .set(auth)
      .send({ orderId: order.body.id, qty: 17 })
      .expect(httpStatus.CREATED);
    expect(partial.body.qty).toBe(17);

    await api.get('/v1/quality/grades').set(auth).expect(httpStatus.OK);
    const gradeRow = await QualityResult.create({
      eventId: 'old-grade',
      kind: 'bundle-check',
      gradeCode: 'M4',
      goodQty: 1,
    });
    await api.patch('/v1/quality/grades/M4').set(auth).send({ name: 'Seconds' }).expect(httpStatus.OK);
    const unchanged = await QualityResult.findById(gradeRow.id);
    expect(unchanged.gradeCode).toBe('M4');

    const client = await api.post('/v1/warehouse/clients').set(auth).send({ name: 'Buyer', address: 'Delhi' }).expect(httpStatus.CREATED);
    const clientOrder = await api
      .post('/v1/warehouse/orders')
      .set(auth)
      .send({ clientId: client.body.id, targetBoxes: 1 })
      .expect(httpStatus.CREATED);
    await api.patch(`/v1/warehouse/clients/${client.body.id}`).set(auth).send({ address: 'Mumbai' });
    await api
      .post('/v1/quality/final-checks')
      .set(auth)
      .send({ eventId: 'final-1', orderId: order.body.id, goodQty: 60 })
      .expect(httpStatus.CREATED);
    const bundle = await api
      .post('/v1/warehouse/packing-bundles')
      .set(auth)
      .send({ orderId: order.body.id, qty: 60, revisionId: 'V5' })
      .expect(httpStatus.CREATED);
    const box = await api
      .post('/v1/warehouse/boxes')
      .set(auth)
      .send({
        packingBundleBarcodes: [bundle.body.barcode],
        scaleWeight: 8,
        clientOrderId: clientOrder.body.id,
        productionOrderId: order.body.id,
        revisionId: 'V5',
        rollBarcode: barcode,
        poId: poRes.body.id,
      })
      .expect(httpStatus.CREATED);
    await api.post('/v1/warehouse/boxes/rack').set(auth).send({ boxBarcode: box.body.barcode, rackCode: 'W1' }).expect(httpStatus.OK);
    const dispatched = await api
      .post('/v1/warehouse/dispatch')
      .set(auth)
      .send({ boxBarcode: box.body.barcode, eventId: 'ship-1', site: 'factory' })
      .expect(httpStatus.OK);
    const dispatchedAgain = await api
      .post('/v1/warehouse/dispatch')
      .set(auth)
      .send({ boxBarcode: box.body.barcode, eventId: 'ship-1', site: 'factory' })
      .expect(httpStatus.OK);
    expect(dispatchedAgain.body.id).toBe(dispatched.body.id);
    expect(dispatched.body.clientAddress).toBe('Delhi');

    const invoice = await api.post('/v1/accounts/invoices').set(auth).send({ boxId: box.body.id, hsn: '6213', gst: '5' }).expect(httpStatus.CREATED);
    const invoiceAgain = await api.post('/v1/accounts/invoices').set(auth).send({ boxId: box.body.id }).expect(httpStatus.CREATED);
    expect(invoiceAgain.body.number).toBe(invoice.body.number);
    expect(await SalesInvoice.countDocuments({ boxId: box.body.id })).toBe(1);
    const note = await api
      .post('/v1/accounts/credit-notes')
      .set(auth)
      .send({ invoiceId: invoice.body.id, pieceCount: 2, reason: 'shortage' })
      .expect(httpStatus.CREATED);
    const still = await SalesInvoice.findById(invoice.body.id);
    expect(still.lines[0].pieceCount).toBe(60);
    expect(note.body.pieceCount).toBe(2);

    const storeUserId = new mongoose.Types.ObjectId();
    await insertUsers([
      {
        _id: storeUserId,
        name: 'Store',
        email: 'store-preset@addon.test',
        password: 'password1',
        role: 'user',
        navigation: { ...getDefaultNavigationByRole('user'), ...accessPreset('store') },
      },
    ]);
    const storeToken = generateToken(storeUserId, moment().add(config.jwt.accessExpirationMinutes, 'minutes'), tokenTypes.ACCESS);
    await api
      .post('/v1/accounts/invoices')
      .set('Authorization', `Bearer ${storeToken}`)
      .send({ boxId: box.body.id })
      .expect(httpStatus.FORBIDDEN);
  },
    60000
  );

  test(
    'issuing a racked roll writes the caller on the order log',
    async () => {
      const fabric = await FabricCatalog.create({ name: 'Cambric', rate: 8 });
      const po = await api
        .post('/v1/store/purchase-orders')
        .set(auth)
        .send({
          supplierName: 'Mill B',
          lines: [{ lineId: 'L1', fabricId: String(fabric._id), fabricName: 'Cambric', quantity: 40 }],
        })
        .expect(httpStatus.CREATED);
      await api.post(`/v1/store/purchase-orders/${po.body.id}/submit`).set(auth).expect(httpStatus.OK);
      const lot = await api
        .post('/v1/store/lots')
        .set(auth)
        .send({ poId: po.body.id, cutoffs: [{ fabricId: String(fabric._id) }] })
        .expect(httpStatus.CREATED);
      await api
        .post(`/v1/store/lots/${lot.body.id}/cutoffs`)
        .set(auth)
        .send({ decisions: [{ fabricId: String(fabric._id), approved: true }] })
        .expect(httpStatus.OK);
      await api
        .post('/v1/store/packing-lists')
        .set(auth)
        .send({
          lotId: lot.body.id,
          packingListCode: 'PL-LOG',
          shipmentDate: new Date().toISOString(),
          expectedDelivery: new Date().toISOString(),
          fabricName: 'Cambric',
          rolls: 2,
          quantity: 40,
          weight: 20,
        })
        .expect(httpStatus.CREATED);
      const receipt = await api
        .post('/v1/store/receipts')
        .set(auth)
        .send({
          lotId: lot.body.id,
          eventId: 'grn-log',
          rolls: [{ scaleWeight: 4 }, { scaleWeight: 5 }],
        })
        .expect(httpStatus.CREATED);
      const [onRack, loose] = receipt.body.rolls;
      await api.post('/v1/store/racks').set(auth).send({ rollBarcode: onRack.barcode, rackCode: 'A1' }).expect(httpStatus.CREATED);
      await api
        .post('/v1/quality/fabric-samples')
        .set(auth)
        .send({ eventId: 'sample-pass', lotId: lot.body.id, rollBarcode: onRack.barcode, passed: true })
        .expect(httpStatus.CREATED);
      await api.post(`/v1/quality/lots/${lot.body.id}/pass`).set(auth).expect(httpStatus.OK);
      const order = await api
        .post('/v1/production/orders')
        .set(auth)
        .send({ productionType: 'normal', revisionId: 'V1', targetQty: 60 })
        .expect(httpStatus.CREATED);
      await api
        .post('/v1/store/issues')
        .set(auth)
        .send({ rollBarcode: loose.barcode, orderId: order.body.id })
        .expect(httpStatus.BAD_REQUEST);
      await api
        .post('/v1/store/issues')
        .set(auth)
        .send({ rollBarcode: onRack.barcode, orderId: order.body.id, eventId: 'iss-log' })
        .expect(httpStatus.CREATED);
      const logs = await api
        .get(`/v1/production/orders/${order.body.id}/logs`)
        .query({ action: 'issued' })
        .set(auth)
        .expect(httpStatus.OK);
      expect(logs.body.results).toHaveLength(1);
      expect(logs.body.results[0].userId).toBe(String(superId));
      expect(logs.body.results[0].userName).toBe('Super');
      expect(logs.body.results[0].entityCode).toBe(onRack.barcode);
    },
    60000
  );

  test(
    'a completion on the wrong floor is rejected and a full floor moves forward',
    async () => {
      const category = await Category.create({ name: 'Hanky' });
      const cut = await Process.create({
        name: 'Cut',
        type: 'floor',
        description: 'Cut the roll',
        floor: 'vertical-cut',
        sortOrder: 1,
      });
      const iron = await Process.create({
        name: 'Iron',
        type: 'floor',
        description: 'Iron the pieces',
        floor: 'iron',
        sortOrder: 2,
      });
      const product = await Product.create({
        name: 'White',
        category: category.id,
        processes: [{ processId: cut.id }, { processId: iron.id }],
      });
      const order = await api
        .post('/v1/production/orders')
        .set(auth)
        .send({
          itemId: String(product.id),
          productionType: 'normal',
          revisionId: 'V1',
          targetQty: 10,
          priority: 'High',
          orderNote: 'Rush',
        })
        .expect(httpStatus.CREATED);
      expect(order.body.currentFloor).toBe('vertical-cut');
      expect(order.body.floors).toHaveLength(2);
      expect(order.body.floors[0].receivedQty).toBe(10);
      await api
        .post('/v1/production/completions')
        .set(auth)
        .send({ eventId: 'wrong-floor', orderId: order.body.id, stage: 'iron', qty: 10, site: 'factory' })
        .expect(httpStatus.BAD_REQUEST);
      await api
        .post('/v1/production/completions')
        .set(auth)
        .send({ eventId: 'cut-done', orderId: order.body.id, stage: 'vertical-cut', qty: 10, site: 'factory' })
        .expect(httpStatus.CREATED);
      const stayed = await ProductionOrder.findById(order.body.id);
      expect(stayed.currentFloor).toBe('vertical-cut');
      const sent = await api
        .post(`/v1/production/orders/${order.body.id}/transfer`)
        .set(auth)
        .send({ qty: 10 })
        .expect(httpStatus.CREATED);
      expect(sent.body.barcode).toMatch(/^BD-/);
      expect(sent.body.status).toBe('in-transit');
      const waiting = await api.get('/v1/production/orders').query({ floor: 'iron' }).set(auth).expect(httpStatus.OK);
      expect(waiting.body.results.map((row) => row.id)).not.toContain(order.body.id);
      await api
        .post('/v1/production/bundles/receive')
        .set(auth)
        .send({ barcode: sent.body.barcode, stage: 'vertical-cut' })
        .expect(httpStatus.BAD_REQUEST);
      await api
        .post('/v1/production/bundles/receive')
        .set(auth)
        .send({ barcode: sent.body.barcode, stage: 'iron' })
        .expect(httpStatus.CREATED);
      const moved = await ProductionOrder.findById(order.body.id);
      expect(moved.currentFloor).toBe('iron');
      expect(moved.status).toBe('in-progress');
      expect(moved.floors[1].receivedQty).toBe(10);
      const logs = await api
        .get(`/v1/production/orders/${order.body.id}/logs`)
        .query({ action: 'bundle-receive' })
        .set(auth)
        .expect(httpStatus.OK);
      expect(logs.body.results[0].userId).toBe(String(superId));
      expect(logs.body.results[0].fromLocation).toBe('vertical-cut');
      expect(logs.body.results[0].toLocation).toBe('iron');
      expect(logs.body.results[0].entityCode).toBe(sent.body.barcode);
    },
    60000
  );

  test('a draft does not pin, and release keeps that revision after a later publish', async () => {
    const category = await Category.create({ name: 'Raise cat' });
    const fabric = await FabricCatalog.create({ name: 'Raise cambric', rate: 8 });
    const product = await Product.create({
      name: 'Show hanky',
      category: category.id,
      productionType: 'normal',
      piecesPerCut: 4,
      factoryCode: 'A309',
      articleName: 'Half terry',
      bom: [
        {
          bomLineId: 'fab-1',
          fabricCatalogId: fabric.id,
          fabricName: 'Raise cambric',
          quantity: 0.2,
          unitCost: 8,
        },
      ],
    });
    const published = await publishItemDefinition(product);
    const revisionId = String(published.revision.id || published.revision._id);
    const draft = await api
      .post('/v1/production/orders')
      .set(auth)
      .send({
        buyer: 'Showroom',
        priority: 'High',
        orderNote: 'October',
        requiredBy: '2026-12-01',
        lines: [{ itemId: String(product.id), quantity: 100, priority: 'High', revisionId, piecesPerCut: 4, remarks: 'rush' }],
      })
      .expect(httpStatus.CREATED);
    expect(draft.body.status).toBe('pending');
    expect(draft.body.orderNumber).toMatch(/^ORD-\d{6}$/);
    expect(await VersionPin.countDocuments({ scopeId: published.scopeId })).toBe(0);

    const preview = await api
      .post(`/v1/production/orders/${draft.body.id}/release`)
      .set(auth)
      .send({ confirm: false })
      .expect(httpStatus.OK);
    expect(preview.body.preview).toBe(true);
    expect(preview.body.lines[0].snapshot.piecesPerCut).toBe(4);
    expect(preview.body.lines[0].snapshot.fabricBom[0].metresPerPiece).toBe(0.2);

    const released = await api
      .post(`/v1/production/orders/${draft.body.id}/release`)
      .set(auth)
      .send({ confirm: true })
      .expect(httpStatus.OK);
    expect(released.body.status).toBe('released');
    expect(released.body.lines[0].pinId).toBeTruthy();
    expect(released.body.lines[0].snapshot.currency).toBe('INR');
    expect(await VersionPin.countDocuments({ scopeId: published.scopeId, kind: 'release' })).toBe(1);

    product.bom[0].quantity = 9;
    product.markModified('bom');
    await product.save();
    const nextPublish = await publishItemDefinition(product);
    const nextRevisionId = String(nextPublish.revision.id || nextPublish.revision._id);
    const stored = await ProductionOrder.findById(draft.body.id);
    expect(stored.lines[0].snapshot.fabricBom[0].metresPerPiece).toBe(0.2);
    expect(stored.revisionId).toBe(revisionId);

    await api
      .post('/v1/production/completions')
      .set(auth)
      .send({ eventId: 'raise-cut', orderId: draft.body.id, stage: 'vertical-cut', qty: 40, site: 'factory' })
      .expect(httpStatus.CREATED);
    const amended = await api
      .post(`/v1/production/orders/${draft.body.id}/amend`)
      .set(auth)
      .send({ revisionId: nextRevisionId, remainingQty: 60, lineId: released.body.lines[0].id })
      .expect(httpStatus.OK);
    expect(amended.body.segments[0].qty).toBe(40);
    expect(amended.body.segments[1].revisionId).toBe(nextRevisionId);
    expect(amended.body.segments[1].qty).toBe(60);
    expect(await VersionPin.countDocuments({ scopeId: published.scopeId, kind: 'amendment' })).toBe(1);

    const logs = await api.get(`/v1/production/orders/${draft.body.id}/logs`).set(auth).expect(httpStatus.OK);
    const actions = logs.body.results.map((row) => row.action);
    expect(actions).toContain('order-created');
    expect(actions).toContain('released');
    expect(actions).toContain('amend');
  });
});
