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
import { PurchaseOrder, FabricRoll, StockMovement } from '../../src/models/store.model.js';
import { ProductionOrder, PieceBundle, CutPiece, ThreadUse } from '../../src/models/production.model.js';
import { QualityResult } from '../../src/models/quality.model.js';
import Container from '../../src/models/container.model.js';
import { VersionPin } from '../../src/models/versioning.model.js';
import { publishItemDefinition } from '../../src/services/catalogPublish.service.js';
import { SalesInvoice } from '../../src/models/invoice.model.js';
import Machine from '../../src/models/machine.model.js';
import StorageRack from '../../src/models/storageRack.model.js';
import StyleCode from '../../src/models/styleCode.model.js';
import { ClientOrder, DispatchBox } from '../../src/models/warehouse.model.js';

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

    await Machine.create({ name: 'Vertical cutter', barcode: 'MC-CUT-1' });
    await api
      .post('/v1/production/cuts')
      .set(auth)
      .send({ orderId: order.body.id, rollBarcode: barcode, machineBarcode: 'MC-CUT-1' })
      .expect(httpStatus.BAD_REQUEST);

    await FabricRoll.updateOne({ barcode }, { status: 'issued' });
    await StockMovement.create({
      entityType: 'roll',
      entityId: barcode,
      kind: 'issue',
      orderId: order.body.id,
      fabricName: 'Voile',
      qtyMeters: 40,
    });
    const pieces = await api
      .post('/v1/production/cuts')
      .set(auth)
      .send({ orderId: order.body.id, rollBarcode: barcode, machineBarcode: 'MC-CUT-1' })
      .expect(httpStatus.CREATED);
    expect(pieces.body).toHaveLength(3);
    expect(pieces.body.every((piece) => !piece.bundleId)).toBe(true);
    expect(await PieceBundle.countDocuments({ orderId: order.body.id })).toBe(0);
    expect((await FabricRoll.findOne({ barcode })).status).toBe('cut');

    await Container.create({ code: 'PC-BOX', name: 'Piece box', type: 'pieces', barcode: 'CT-PIECES' });
    await StorageRack.create({ code: 'PF-1', name: 'Piece rack', stockType: 'pieces', barcode: 'PF-1' });
    const placed = await api
      .post('/v1/production/cuts/place')
      .set(auth)
      .send({
        pieceBarcodes: pieces.body.map((piece) => piece.barcode),
        containerBarcode: 'CT-PIECES',
        rackCode: 'PF-1',
      })
      .expect(httpStatus.OK);
    expect(placed.body).toHaveLength(3);
    expect(placed.body.every((piece) => piece.status === 'on-rack' && piece.rackCode === 'PF-1')).toBe(true);

    await api
      .post('/v1/production/cuts')
      .set(auth)
      .send({ orderId: order.body.id, rollBarcode: barcode, machineBarcode: 'MC-CUT-1' })
      .expect(httpStatus.BAD_REQUEST);

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

  test(
    'vertical cutting rejects an unissued roll and closes an issued roll into pieces',
    async () => {
      const order = await api
        .post('/v1/production/orders')
        .set(auth)
        .send({ productionType: 'normal', revisionId: 'V1', targetQty: 100, priority: 'Medium' })
        .expect(httpStatus.CREATED);
      const roll = await FabricRoll.create({
        barcode: 'ROLL-VC-1',
        lotId: new mongoose.Types.ObjectId(),
        grnId: new mongoose.Types.ObjectId(),
        poId: new mongoose.Types.ObjectId(),
        scaleWeight: 12,
        fabricName: 'Voile',
        qtyMeters: 40,
        status: 'stored',
      });
      await Machine.create({ name: 'Vertical cutter', barcode: 'MC-VC-1' });
      await api
        .post('/v1/production/cuts')
        .set(auth)
        .send({ orderId: order.body.id, rollBarcode: roll.barcode, machineBarcode: 'MC-VC-1' })
        .expect(httpStatus.BAD_REQUEST);

      roll.status = 'issued';
      await roll.save();
      await StockMovement.create({
        entityType: 'roll',
        entityId: roll.barcode,
        kind: 'issue',
        orderId: order.body.id,
        fabricName: 'Voile',
        qtyMeters: 40,
      });
      const pieces = await api
        .post('/v1/production/cuts')
        .set(auth)
        .send({ orderId: order.body.id, rollBarcode: 'ROLL-VC-1', machineBarcode: 'MC-VC-1', pieceCount: 61 })
        .expect(httpStatus.CREATED);
      expect(pieces.body).toHaveLength(3);
      expect(pieces.body.every((piece) => !piece.bundleId)).toBe(true);
      expect(await PieceBundle.countDocuments({ orderId: order.body.id })).toBe(0);
      expect((await FabricRoll.findOne({ barcode: 'ROLL-VC-1' })).status).toBe('cut');

      await api
        .post('/v1/production/cuts')
        .set(auth)
        .send({ orderId: order.body.id, rollBarcode: 'ROLL-VC-1', machineBarcode: 'MC-VC-1' })
        .expect(httpStatus.BAD_REQUEST);

      await Container.create({ code: 'PC-BOX-2', name: 'Piece box', type: 'pieces', barcode: 'CT-VC' });
      await StorageRack.create({ code: 'FAB-1', name: 'Fabric rack', stockType: 'fabric', barcode: 'FAB-1' });
      await api
        .post('/v1/production/cuts/place')
        .set(auth)
        .send({
          pieceBarcodes: pieces.body.map((piece) => piece.barcode),
          containerBarcode: 'CT-VC',
          rackCode: 'FAB-1',
        })
        .expect(httpStatus.BAD_REQUEST);
      await StorageRack.create({ code: 'PF-VC', name: 'Piece rack', stockType: 'pieces', barcode: 'PF-VC' });
      const placed = await api
        .post('/v1/production/cuts/place')
        .set(auth)
        .send({
          pieceBarcodes: pieces.body.map((piece) => piece.barcode),
          containerBarcode: 'CT-VC',
          rackCode: 'PF-VC',
        })
        .expect(httpStatus.OK);
      expect(placed.body.every((piece) => piece.status === 'on-rack' && piece.rackCode === 'PF-VC')).toBe(true);
    },
    60000
  );

  test(
    'selvage rejects a piece that is not on a rack and puts a racked piece back for half moon',
    async () => {
      const order = await api
        .post('/v1/production/orders')
        .set(auth)
        .send({ productionType: 'normal', revisionId: 'V1', targetQty: 30, priority: 'Medium' })
        .expect(httpStatus.CREATED);
      const piece = await CutPiece.create({
        barcode: 'PC-SEL-1',
        orderId: order.body.id,
        rollBarcode: 'ROLL-SEL-1',
        status: 'cut',
        process: 'vertical-cut',
      });
      await Machine.create({ name: 'Selvage table', barcode: 'MC-SEL-1' });
      await StorageRack.create({ code: 'PF-SEL', name: 'Piece rack', stockType: 'pieces', barcode: 'PF-SEL' });
      await api
        .post('/v1/production/selvage/start')
        .set(auth)
        .send({ pieceBarcodes: [piece.barcode], rackCode: 'PF-SEL', machineBarcode: 'MC-SEL-1' })
        .expect(httpStatus.BAD_REQUEST);

      piece.status = 'on-rack';
      piece.rackCode = 'PF-SEL';
      await piece.save();
      const started = await api
        .post('/v1/production/selvage/start')
        .set(auth)
        .send({ pieceBarcodes: ['PC-SEL-1'], rackCode: 'PF-SEL', machineBarcode: 'MC-SEL-1' })
        .expect(httpStatus.OK);
      expect(started.body[0].status).toBe('in-work');

      await StorageRack.create({ code: 'FAB-SEL', name: 'Fabric rack', stockType: 'fabric', barcode: 'FAB-SEL' });
      await api
        .post('/v1/production/selvage/place')
        .set(auth)
        .send({ pieceBarcodes: ['PC-SEL-1'], rackCode: 'FAB-SEL' })
        .expect(httpStatus.BAD_REQUEST);

      await StorageRack.create({ code: 'PF-SEL-B', name: 'Piece rack B', stockType: 'pieces', barcode: 'PF-SEL-B' });
      const placed = await api
        .post('/v1/production/selvage/place')
        .set(auth)
        .send({ pieceBarcodes: ['PC-SEL-1'], rackCode: 'PF-SEL-B' })
        .expect(httpStatus.OK);
      expect(placed.body[0].process).toBe('selvage');
      expect(placed.body[0].status).toBe('on-rack');
      expect(placed.body[0].rackCode).toBe('PF-SEL-B');
      expect(placed.body[0].barcode).toBe('PC-SEL-1');

      await api
        .post('/v1/production/selvage/place')
        .set(auth)
        .send({ pieceBarcodes: ['PC-SEL-1'], rackCode: 'PF-SEL-B' })
        .expect(httpStatus.BAD_REQUEST);
    },
    60000
  );

  test(
    'half moon rejects a piece that is not selvaged and puts a selvage piece back for vertical hem',
    async () => {
      const order = await api
        .post('/v1/production/orders')
        .set(auth)
        .send({ productionType: 'normal', revisionId: 'V1', targetQty: 30, priority: 'Medium' })
        .expect(httpStatus.CREATED);
      await Machine.create({ name: 'Half moon table', barcode: 'MC-HM-1' });
      await StorageRack.create({ code: 'PF-HM', name: 'Piece rack', stockType: 'pieces', barcode: 'PF-HM' });
      await CutPiece.create({
        barcode: 'PC-HM-CUT',
        orderId: order.body.id,
        rollBarcode: 'ROLL-HM-1',
        status: 'cut',
        process: 'vertical-cut',
      });
      await api
        .post('/v1/production/half-moon/start')
        .set(auth)
        .send({ pieceBarcodes: ['PC-HM-CUT'], rackCode: 'PF-HM', machineBarcode: 'MC-HM-1' })
        .expect(httpStatus.BAD_REQUEST);

      await CutPiece.create({
        barcode: 'PC-HM-VC',
        orderId: order.body.id,
        rollBarcode: 'ROLL-HM-1',
        status: 'on-rack',
        process: 'vertical-cut',
        rackCode: 'PF-HM',
      });
      await api
        .post('/v1/production/half-moon/start')
        .set(auth)
        .send({ pieceBarcodes: ['PC-HM-VC'], rackCode: 'PF-HM', machineBarcode: 'MC-HM-1' })
        .expect(httpStatus.BAD_REQUEST);

      await CutPiece.create({
        barcode: 'PC-HM-1',
        orderId: order.body.id,
        rollBarcode: 'ROLL-HM-1',
        status: 'on-rack',
        process: 'selvage',
        rackCode: 'PF-HM',
      });
      const started = await api
        .post('/v1/production/half-moon/start')
        .set(auth)
        .send({ pieceBarcodes: ['PC-HM-1'], rackCode: 'PF-HM', machineBarcode: 'MC-HM-1' })
        .expect(httpStatus.OK);
      expect(started.body[0].status).toBe('in-work');
      expect(started.body[0].process).toBe('selvage');

      await StorageRack.create({ code: 'FAB-HM', name: 'Fabric rack', stockType: 'fabric', barcode: 'FAB-HM' });
      await api
        .post('/v1/production/half-moon/place')
        .set(auth)
        .send({ pieceBarcodes: ['PC-HM-1'], rackCode: 'FAB-HM' })
        .expect(httpStatus.BAD_REQUEST);

      await StorageRack.create({ code: 'PF-HM-B', name: 'Piece rack B', stockType: 'pieces', barcode: 'PF-HM-B' });
      const placed = await api
        .post('/v1/production/half-moon/place')
        .set(auth)
        .send({ pieceBarcodes: ['PC-HM-1'], rackCode: 'PF-HM-B' })
        .expect(httpStatus.OK);
      expect(placed.body[0].process).toBe('half-moon');
      expect(placed.body[0].status).toBe('on-rack');
      expect(placed.body[0].rackCode).toBe('PF-HM-B');
      expect(placed.body[0].barcode).toBe('PC-HM-1');

      await api
        .post('/v1/production/half-moon/place')
        .set(auth)
        .send({ pieceBarcodes: ['PC-HM-1'], rackCode: 'PF-HM-B' })
        .expect(httpStatus.BAD_REQUEST);
    },
    60000
  );

  test(
    'vertical hemming rejects a piece that is not half mooned and records thread on a pieces rack',
    async () => {
      const order = await api
        .post('/v1/production/orders')
        .set(auth)
        .send({ productionType: 'normal', revisionId: 'V1', targetQty: 30, priority: 'Medium' })
        .expect(httpStatus.CREATED);
      const saved = await ProductionOrder.findById(order.body.id);
      saved.lines.push({
        itemId: new mongoose.Types.ObjectId(),
        productionType: 'normal',
        quantity: 30,
        snapshot: {
          threadLines: [{ lineId: 'sew-1', materialRole: 'sewing-thread', quantity: 0.2, rawMaterialId: '' }],
        },
      });
      await saved.save();
      await Machine.create({ name: 'Hem machine', barcode: 'MC-VH-1' });
      await StorageRack.create({ code: 'PF-VH', name: 'Piece rack', stockType: 'pieces', barcode: 'PF-VH' });
      await CutPiece.create({
        barcode: 'PC-VH-CUT',
        orderId: order.body.id,
        rollBarcode: 'ROLL-VH-1',
        status: 'cut',
        process: 'vertical-cut',
      });
      await api
        .post('/v1/production/vertical-hem/start')
        .set(auth)
        .send({ pieceBarcodes: ['PC-VH-CUT'], rackCode: 'PF-VH', machineBarcode: 'MC-VH-1' })
        .expect(httpStatus.BAD_REQUEST);

      await CutPiece.create({
        barcode: 'PC-VH-SEL',
        orderId: order.body.id,
        rollBarcode: 'ROLL-VH-1',
        status: 'on-rack',
        process: 'selvage',
        rackCode: 'PF-VH',
      });
      await api
        .post('/v1/production/vertical-hem/start')
        .set(auth)
        .send({ pieceBarcodes: ['PC-VH-SEL'], rackCode: 'PF-VH', machineBarcode: 'MC-VH-1' })
        .expect(httpStatus.BAD_REQUEST);

      await CutPiece.create({
        barcode: 'PC-VH-1',
        orderId: order.body.id,
        rollBarcode: 'ROLL-VH-1',
        status: 'on-rack',
        process: 'half-moon',
        rackCode: 'PF-VH',
      });
      const started = await api
        .post('/v1/production/vertical-hem/start')
        .set(auth)
        .send({ pieceBarcodes: ['PC-VH-1'], rackCode: 'PF-VH', machineBarcode: 'MC-VH-1' })
        .expect(httpStatus.OK);
      expect(started.body[0].status).toBe('in-work');
      expect(started.body[0].process).toBe('half-moon');

      await StorageRack.create({ code: 'FAB-VH', name: 'Fabric rack', stockType: 'fabric', barcode: 'FAB-VH' });
      await api
        .post('/v1/production/vertical-hem/place')
        .set(auth)
        .send({ pieceBarcodes: ['PC-VH-1'], rackCode: 'FAB-VH', threadQuantity: 5 })
        .expect(httpStatus.BAD_REQUEST);

      await StorageRack.create({ code: 'PF-VH-B', name: 'Piece rack B', stockType: 'pieces', barcode: 'PF-VH-B' });
      const placed = await api
        .post('/v1/production/vertical-hem/place')
        .set(auth)
        .send({ pieceBarcodes: ['PC-VH-1'], rackCode: 'PF-VH-B', threadQuantity: 5 })
        .expect(httpStatus.OK);
      expect(placed.body[0].process).toBe('vertical-hem');
      expect(placed.body[0].status).toBe('on-rack');
      expect(placed.body[0].rackCode).toBe('PF-VH-B');
      expect(placed.body[0].barcode).toBe('PC-VH-1');

      const uses = await ThreadUse.find({ orderId: order.body.id });
      expect(uses).toHaveLength(1);
      expect(uses[0].materialRole).toBe('sewing-thread');
      expect(uses[0].quantity).toBe(5);
      expect(uses[0].machineBarcode).toBe('MC-VH-1');
      const pinned = await ProductionOrder.findById(order.body.id);
      expect(pinned.lines[0].snapshot.threadLines[0].quantity).toBe(0.2);

      await api
        .post('/v1/production/vertical-hem/place')
        .set(auth)
        .send({ pieceBarcodes: ['PC-VH-1'], rackCode: 'PF-VH-B', threadQuantity: 5 })
        .expect(httpStatus.BAD_REQUEST);
    },
    60000
  );

  test(
    'single piece cutting rejects a piece that is not hemmed, closes 60, and keeps the hand count',
    async () => {
      const order = await api
        .post('/v1/production/orders')
        .set(auth)
        .send({ productionType: 'normal', revisionId: 'V1', targetQty: 30, priority: 'Medium' })
        .expect(httpStatus.CREATED);
      await Machine.create({ name: 'Single piece table', barcode: 'MC-SP-1' });
      await StorageRack.create({ code: 'PF-SP', name: 'Piece rack', stockType: 'pieces', barcode: 'PF-SP' });
      await CutPiece.create({
        barcode: 'PC-SP-CUT',
        orderId: order.body.id,
        rollBarcode: 'ROLL-SP-1',
        status: 'cut',
        process: 'vertical-cut',
      });
      await api
        .post('/v1/production/single-piece/start')
        .set(auth)
        .send({ pieceBarcodes: ['PC-SP-CUT'], rackCode: 'PF-SP', machineBarcode: 'MC-SP-1' })
        .expect(httpStatus.BAD_REQUEST);

      await CutPiece.create({
        barcode: 'PC-SP-HM',
        orderId: order.body.id,
        rollBarcode: 'ROLL-SP-1',
        status: 'on-rack',
        process: 'half-moon',
        rackCode: 'PF-SP',
      });
      await api
        .post('/v1/production/single-piece/start')
        .set(auth)
        .send({ pieceBarcodes: ['PC-SP-HM'], rackCode: 'PF-SP', machineBarcode: 'MC-SP-1' })
        .expect(httpStatus.BAD_REQUEST);

      await CutPiece.create({
        barcode: 'PC-SP-1',
        orderId: order.body.id,
        rollBarcode: 'ROLL-SP-1',
        status: 'on-rack',
        process: 'vertical-hem',
        rackCode: 'PF-SP',
      });
      const started = await api
        .post('/v1/production/single-piece/start')
        .set(auth)
        .send({ pieceBarcodes: ['PC-SP-1'], rackCode: 'PF-SP', machineBarcode: 'MC-SP-1' })
        .expect(httpStatus.OK);
      expect(started.body[0].status).toBe('in-work');
      expect(started.body[0].barcode).toBe('PC-SP-1');

      const cut = await api
        .post('/v1/production/single-piece/cut')
        .set(auth)
        .send({ pieces: [{ barcode: 'PC-SP-1', goodQty: 61, m4Qty: 3 }] })
        .expect(httpStatus.CREATED);
      expect(cut.body.closed).toHaveLength(1);
      expect(cut.body.closed[0].qty).toBe(60);
      expect(cut.body.closed[0].barcode.startsWith('BD-')).toBe(true);
      expect(cut.body.open).toHaveLength(1);
      expect(cut.body.open[0].qty).toBe(1);
      expect(cut.body.open[0].barcode).toBe('');
      const piece = await CutPiece.findOne({ barcode: 'PC-SP-1' });
      expect(piece.status).toBe('bundled');
      expect(piece.goodQty).toBe(61);
      expect(piece.m4Qty).toBe(3);
      expect(piece.barcode).toBe('PC-SP-1');
      const bundles = await PieceBundle.find({ orderId: order.body.id });
      expect(bundles.reduce((sum, row) => sum + row.qty, 0)).toBe(61);

      const closed = await api
        .post('/v1/production/single-piece/close')
        .set(auth)
        .send({ orderId: order.body.id })
        .expect(httpStatus.OK);
      expect(closed.body.qty).toBe(1);
      expect(closed.body.closed).toBe(true);
      expect(closed.body.barcode.startsWith('BD-')).toBe(true);
      expect(closed.body.checkedGood).toBe(false);

      await api
        .post('/v1/production/single-piece/place')
        .set(auth)
        .send({ bundleBarcodes: [closed.body.barcode], rackCode: 'PF-SP' })
        .expect(httpStatus.BAD_REQUEST);

      await StorageRack.create({ code: 'BDL-SP', name: 'Bundle rack', stockType: 'bundles', barcode: 'BDL-SP' });
      const placed = await api
        .post('/v1/production/single-piece/place')
        .set(auth)
        .send({ bundleBarcodes: [closed.body.barcode], rackCode: 'BDL-SP' })
        .expect(httpStatus.OK);
      expect(placed.body[0].rackCode).toBe('BDL-SP');
      expect(placed.body[0].checkedGood).toBe(false);
      expect(placed.body[0].status).not.toBe('in-transit');

      await api
        .post('/v1/production/single-piece/cut')
        .set(auth)
        .send({ pieces: [{ barcode: 'PC-SP-1', goodQty: 1, m4Qty: 0 }] })
        .expect(httpStatus.BAD_REQUEST);
    },
    60000
  );

  test(
    'horizontal hemming rejects an unchecked bundle and records thread on a bundles rack',
    async () => {
      const order = await api
        .post('/v1/production/orders')
        .set(auth)
        .send({ productionType: 'normal', revisionId: 'V1', targetQty: 30, priority: 'Medium' })
        .expect(httpStatus.CREATED);
      const saved = await ProductionOrder.findById(order.body.id);
      saved.lines.push({
        itemId: new mongoose.Types.ObjectId(),
        productionType: 'normal',
        quantity: 30,
        snapshot: {
          threadLines: [{ lineId: 'sew-1', materialRole: 'sewing-thread', quantity: 0.2, rawMaterialId: '' }],
        },
      });
      await saved.save();
      await Machine.create({ name: 'Horizontal hem machine', barcode: 'MC-HH-1' });
      await StorageRack.create({ code: 'BDL-HH', name: 'Bundle rack', stockType: 'bundles', barcode: 'BDL-HH' });
      await PieceBundle.create({
        orderId: order.body.id,
        number: 1,
        qty: 17,
        closed: true,
        barcode: 'BD-HH-BAD',
        rackCode: 'BDL-HH',
        checkedGood: false,
        status: 'closed',
        process: 'created',
      });
      await api
        .post('/v1/production/horizontal-hem/start')
        .set(auth)
        .send({ bundleBarcodes: ['BD-HH-BAD'], rackCode: 'BDL-HH', machineBarcode: 'MC-HH-1' })
        .expect(httpStatus.BAD_REQUEST);

      await PieceBundle.create({
        orderId: order.body.id,
        number: 2,
        qty: 60,
        closed: true,
        barcode: 'BD-HH-1',
        rackCode: 'BDL-HH',
        checkedGood: true,
        status: 'closed',
        process: 'created',
      });
      const started = await api
        .post('/v1/production/horizontal-hem/start')
        .set(auth)
        .send({ bundleBarcodes: ['BD-HH-1'], rackCode: 'BDL-HH', machineBarcode: 'MC-HH-1' })
        .expect(httpStatus.OK);
      expect(started.body[0].machineBarcode).toBe('MC-HH-1');
      expect(started.body[0].rackCode).toBe('');
      expect(started.body[0].process).toBe('created');
      expect(started.body[0].qty).toBe(60);

      await StorageRack.create({ code: 'PF-HH', name: 'Piece rack', stockType: 'pieces', barcode: 'PF-HH' });
      await api
        .post('/v1/production/horizontal-hem/place')
        .set(auth)
        .send({ bundleBarcodes: ['BD-HH-1'], rackCode: 'PF-HH', threadQuantity: 5 })
        .expect(httpStatus.BAD_REQUEST);

      await StorageRack.create({ code: 'BDL-HH-B', name: 'Bundle rack B', stockType: 'bundles', barcode: 'BDL-HH-B' });
      const placed = await api
        .post('/v1/production/horizontal-hem/place')
        .set(auth)
        .send({ bundleBarcodes: ['BD-HH-1'], rackCode: 'BDL-HH-B', threadQuantity: 5 })
        .expect(httpStatus.OK);
      expect(placed.body[0].process).toBe('horizontal-hem');
      expect(placed.body[0].rackCode).toBe('BDL-HH-B');
      expect(placed.body[0].checkedGood).toBe(true);
      expect(placed.body[0].qty).toBe(60);
      expect(placed.body[0].barcode).toBe('BD-HH-1');
      expect(placed.body[0].status).toBe('closed');

      const uses = await ThreadUse.find({ orderId: order.body.id });
      expect(uses).toHaveLength(1);
      expect(uses[0].materialRole).toBe('sewing-thread');
      expect(uses[0].quantity).toBe(5);
      expect(uses[0].machineBarcode).toBe('MC-HH-1');
      const pinned = await ProductionOrder.findById(order.body.id);
      expect(pinned.lines[0].snapshot.threadLines[0].quantity).toBe(0.2);

      await api
        .post('/v1/production/horizontal-hem/place')
        .set(auth)
        .send({ bundleBarcodes: ['BD-HH-1'], rackCode: 'BDL-HH-B', threadQuantity: 5 })
        .expect(httpStatus.BAD_REQUEST);
    },
    60000
  );

  test(
    'thread cutting rejects a bundle that is not hemmed and puts a hemmed bundle back on a bundles rack',
    async () => {
      const order = await api
        .post('/v1/production/orders')
        .set(auth)
        .send({ productionType: 'normal', revisionId: 'V1', targetQty: 30, priority: 'Medium' })
        .expect(httpStatus.CREATED);
      await Machine.create({ name: 'Thread cut table', barcode: 'MC-TC-1' });
      await StorageRack.create({ code: 'BDL-TC', name: 'Bundle rack', stockType: 'bundles', barcode: 'BDL-TC' });
      await PieceBundle.create({
        orderId: order.body.id,
        number: 1,
        qty: 17,
        closed: true,
        barcode: 'BD-TC-NEW',
        rackCode: 'BDL-TC',
        checkedGood: true,
        status: 'closed',
        process: 'created',
      });
      await api
        .post('/v1/production/thread-cut/start')
        .set(auth)
        .send({ bundleBarcodes: ['BD-TC-NEW'], rackCode: 'BDL-TC', machineBarcode: 'MC-TC-1' })
        .expect(httpStatus.BAD_REQUEST);

      await PieceBundle.create({
        orderId: order.body.id,
        number: 2,
        qty: 60,
        closed: true,
        barcode: 'BD-TC-1',
        rackCode: 'BDL-TC',
        checkedGood: true,
        status: 'closed',
        process: 'horizontal-hem',
      });
      const started = await api
        .post('/v1/production/thread-cut/start')
        .set(auth)
        .send({ bundleBarcodes: ['BD-TC-1'], rackCode: 'BDL-TC', machineBarcode: 'MC-TC-1' })
        .expect(httpStatus.OK);
      expect(started.body[0].machineBarcode).toBe('MC-TC-1');
      expect(started.body[0].rackCode).toBe('');
      expect(started.body[0].process).toBe('horizontal-hem');
      expect(started.body[0].qty).toBe(60);

      await StorageRack.create({ code: 'PF-TC', name: 'Piece rack', stockType: 'pieces', barcode: 'PF-TC' });
      await api
        .post('/v1/production/thread-cut/place')
        .set(auth)
        .send({ bundleBarcodes: ['BD-TC-1'], rackCode: 'PF-TC' })
        .expect(httpStatus.BAD_REQUEST);

      await StorageRack.create({ code: 'BDL-TC-B', name: 'Bundle rack B', stockType: 'bundles', barcode: 'BDL-TC-B' });
      const before = await ThreadUse.countDocuments({ orderId: order.body.id });
      const placed = await api
        .post('/v1/production/thread-cut/place')
        .set(auth)
        .send({ bundleBarcodes: ['BD-TC-1'], rackCode: 'BDL-TC-B' })
        .expect(httpStatus.OK);
      expect(placed.body[0].process).toBe('thread-cut');
      expect(placed.body[0].rackCode).toBe('BDL-TC-B');
      expect(placed.body[0].checkedGood).toBe(true);
      expect(placed.body[0].qty).toBe(60);
      expect(placed.body[0].barcode).toBe('BD-TC-1');
      expect(placed.body[0].status).toBe('closed');
      expect(await ThreadUse.countDocuments({ orderId: order.body.id })).toBe(before);

      await api
        .post('/v1/production/thread-cut/place')
        .set(auth)
        .send({ bundleBarcodes: ['BD-TC-1'], rackCode: 'BDL-TC-B' })
        .expect(httpStatus.BAD_REQUEST);
    },
    60000
  );

  test(
    'final qc rejects counts that do not sum and a zero-good bundle does not move on',
    async () => {
      const order = await api.post('/v1/production/orders').set(auth).send({ productionType: 'normal', revisionId: 'V1', targetQty: 60, priority: 'Medium' }).expect(httpStatus.CREATED);
      await StorageRack.create({ code: 'BDL-FQ', name: 'Bundle rack', stockType: 'bundles', barcode: 'BDL-FQ' });
      await StorageRack.create({ code: 'ALT-FQ', name: 'Alter rack', stockType: 'alteration', barcode: 'ALT-FQ' });
      await PieceBundle.create({ orderId: order.body.id, number: 1, qty: 60, closed: true, barcode: 'BD-FQ-1', rackCode: 'BDL-FQ', status: 'closed', process: 'thread-cut', checkedGood: true });
      await api.post('/v1/quality/final-qc').set(auth).send({ bundleBarcode: 'BD-FQ-1', good: 10, long: 0, hemming: 0, sporting: 0, diving: 0, rejection: 0, racks: {} }).expect(httpStatus.BAD_REQUEST);
      const held = await api.post('/v1/quality/final-qc').set(auth).send({ bundleBarcode: 'BD-FQ-1', good: 0, long: 0, hemming: 0, sporting: 0, diving: 0, rejection: 60, racks: { rejection: 'ALT-FQ' } }).expect(httpStatus.OK);
      expect(held.body.process).toBe('thread-cut');
      expect(held.body.finalGood).toBe(0);
      const upcoming = await api.get('/v1/quality/final-qc/upcoming').set(auth).expect(httpStatus.OK);
      expect(upcoming.body.results.find((row) => row.barcode === 'BD-FQ-1')).toBeUndefined();
      await api.post('/v1/production/to-ground/place').set(auth).send({ bundleBarcodes: ['BD-FQ-1'], containerBarcode: 'CT-NONE' }).expect(httpStatus.BAD_REQUEST);
    },
    60000
  );

  test(
    'move to ground rejects a pieces container and ironing puts the bundle on a bundles rack',
    async () => {
      const order = await api.post('/v1/production/orders').set(auth).send({ productionType: 'normal', revisionId: 'V1', targetQty: 60, priority: 'Medium' }).expect(httpStatus.CREATED);
      await StorageRack.create({ code: 'BDL-IR', name: 'Bundle rack', stockType: 'bundles', barcode: 'BDL-IR' });
      await StorageRack.create({ code: 'BDL-IR-B', name: 'Bundle rack B', stockType: 'bundles', barcode: 'BDL-IR-B' });
      await StorageRack.create({ code: 'ALT-IR', name: 'Long rack', stockType: 'long-alteration', barcode: 'ALT-IR' });
      await Container.create({ code: 'CT-PCS', name: 'Pieces box', type: 'pieces', barcode: 'CT-PCS' });
      await Container.create({ code: 'CT-IR', name: 'Bundle box', type: 'bundle', barcode: 'CT-IR' });
      await Machine.create({ name: 'Iron', code: 'MC-IR-1', barcode: 'MC-IR-1' });
      await PieceBundle.create({ orderId: order.body.id, number: 1, qty: 60, closed: true, barcode: 'BD-IR-1', rackCode: 'BDL-IR', status: 'closed', process: 'thread-cut', checkedGood: true });
      const checked = await api.post('/v1/quality/final-qc').set(auth).send({ bundleBarcode: 'BD-IR-1', good: 58, long: 2, hemming: 0, sporting: 0, diving: 0, rejection: 0, racks: { long: 'ALT-IR' } }).expect(httpStatus.OK);
      expect(checked.body.process).toBe('final-qc');
      expect(checked.body.finalGood).toBe(58);
      expect(checked.body.qty).toBe(60);
      await api.post('/v1/production/to-ground/place').set(auth).send({ bundleBarcodes: ['BD-IR-1'], containerBarcode: 'CT-PCS' }).expect(httpStatus.BAD_REQUEST);
      const moved = await api.post('/v1/production/to-ground/place').set(auth).send({ bundleBarcodes: ['BD-IR-1'], containerBarcode: 'CT-IR' }).expect(httpStatus.OK);
      expect(moved.body[0].process).toBe('in-container');
      expect(moved.body[0].rackCode).toBe('');
      expect(moved.body[0].containerBarcode).toBe('CT-IR');
      const started = await api.post('/v1/production/iron/start').set(auth).send({ bundleBarcodes: ['BD-IR-1'], machineBarcode: 'MC-IR-1' }).expect(httpStatus.OK);
      expect(started.body[0].containerBarcode).toBe('');
      expect(started.body[0].machineBarcode).toBe('MC-IR-1');
      expect(started.body[0].process).toBe('in-container');
      const ironed = await api.post('/v1/production/iron/place').set(auth).send({ bundleBarcodes: ['BD-IR-1'], rackCode: 'BDL-IR-B' }).expect(httpStatus.OK);
      expect(ironed.body[0].process).toBe('ironed');
      expect(ironed.body[0].rackCode).toBe('BDL-IR-B');
      expect(ironed.body[0].finalGood).toBe(58);
      expect(ironed.body[0].qty).toBe(60);
      expect(ironed.body[0].barcode).toBe('BD-IR-1');
      const embroidery = await api.get('/v1/production/embroidery/upcoming').set(auth).expect(httpStatus.OK);
      expect(embroidery.body.results.find((row) => row.barcode === 'BD-IR-1')).toBeUndefined();
      await api.post('/v1/production/route-split/break').set(auth).send({ bundleBarcodes: ['BD-IR-1'], pieceCount: 10 }).expect(httpStatus.BAD_REQUEST);
      const broken = await api.post('/v1/production/route-split/break').set(auth).send({ bundleBarcodes: ['BD-IR-1'], pieceCount: 58 }).expect(httpStatus.OK);
      expect(broken.body[0].process).toBe('broken');
      expect(broken.body[0].route).toBe('normal');
      const stillEmbroidery = await api.get('/v1/production/embroidery/upcoming').set(auth).expect(httpStatus.OK);
      expect(stillEmbroidery.body.results.find((row) => row.barcode === 'BD-IR-1')).toBeUndefined();
      await StorageRack.create({ code: 'PK-IR', name: 'Packing rack', stockType: 'packing', barcode: 'PK-IR' });
      await api.post('/v1/quality/final-checking').set(auth).send({ bundleBarcode: 'BD-IR-1', good: 58, defect: 0, rackCode: 'BDL-IR-B' }).expect(httpStatus.BAD_REQUEST);
      const checkedOut = await api.post('/v1/quality/final-checking').set(auth).send({ bundleBarcode: 'BD-IR-1', good: 50, defect: 8, rackCode: 'PK-IR' }).expect(httpStatus.OK);
      expect(checkedOut.body.finalGood).toBe(50);
      expect(checkedOut.body.rackCode).toBe('PK-IR');
      const result = await QualityResult.findOne({ kind: 'final-checking', bundleId: String(checkedOut.body.id) });
      expect(result.goodQty).toBe(50);
      expect(result.defectQty).toBe(8);
      expect(await ThreadUse.countDocuments({ orderId: order.body.id })).toBe(0);
    },
    60000
  );

  test(
    'embroidery records thread before the second iron and a sticker bundle skips that thread cut',
    async () => {
      const embroideryOrder = await api.post('/v1/production/orders').set(auth).send({ productionType: 'embroidery', revisionId: 'V1', targetQty: 60, priority: 'Medium' }).expect(httpStatus.CREATED);
      const stickerOrder = await api.post('/v1/production/orders').set(auth).send({ productionType: 'sticker', revisionId: 'V1', targetQty: 60, priority: 'Medium' }).expect(httpStatus.CREATED);
      await StorageRack.create({ code: 'BDL-RT', name: 'Route rack', stockType: 'bundles', barcode: 'BDL-RT' });
      await StorageRack.create({ code: 'BDL-RT-B', name: 'Route rack B', stockType: 'bundles', barcode: 'BDL-RT-B' });
      await Machine.create({ name: 'Embroidery machine', code: 'MC-EM-1', barcode: 'MC-EM-1' });
      await Machine.create({ name: 'Embroidery table', code: 'MC-ET-1', barcode: 'MC-ET-1' });
      await Machine.create({ name: 'Second iron', code: 'MC-IR-2', barcode: 'MC-IR-2' });
      await PieceBundle.create({ orderId: embroideryOrder.body.id, number: 1, qty: 60, finalGood: 60, closed: true, barcode: 'BD-EM-1', rackCode: 'BDL-RT', status: 'closed', process: 'ironed', checkedGood: true });
      await PieceBundle.create({ orderId: stickerOrder.body.id, number: 1, qty: 60, finalGood: 60, closed: true, barcode: 'BD-ST-1', rackCode: 'BDL-RT', status: 'closed', process: 'ironed', checkedGood: true });
      await api.post('/v1/production/route-split/break').set(auth).send({ bundleBarcodes: ['BD-EM-1'], pieceCount: 60 }).expect(httpStatus.OK);
      await api.post('/v1/production/route-split/break').set(auth).send({ bundleBarcodes: ['BD-ST-1'], pieceCount: 60 }).expect(httpStatus.OK);
      await api.post('/v1/production/iron-after/start').set(auth).send({ bundleBarcodes: ['BD-EM-1'], rackCode: 'BDL-RT', machineBarcode: 'MC-IR-2' }).expect(httpStatus.BAD_REQUEST);
      await api.post('/v1/production/embroidery/start').set(auth).send({ bundleBarcodes: ['BD-EM-1'], rackCode: 'BDL-RT', machineBarcode: 'MC-EM-1' }).expect(httpStatus.OK);
      const embroidered = await api.post('/v1/production/embroidery/place').set(auth).send({ bundleBarcodes: ['BD-EM-1'], rackCode: 'BDL-RT-B', threadQuantity: 4 }).expect(httpStatus.OK);
      expect(embroidered.body[0].process).toBe('embroidery');
      const uses = await ThreadUse.find({ orderId: embroideryOrder.body.id });
      expect(uses).toHaveLength(1);
      expect(uses[0].materialRole).toBe('embroidery-thread');
      expect(uses[0].quantity).toBe(4);
      await api.post('/v1/production/embroidery-thread-cut/start').set(auth).send({ bundleBarcodes: ['BD-EM-1'], rackCode: 'BDL-RT-B', machineBarcode: 'MC-ET-1' }).expect(httpStatus.OK);
      await api.post('/v1/production/embroidery-thread-cut/place').set(auth).send({ bundleBarcodes: ['BD-EM-1'], rackCode: 'BDL-RT' }).expect(httpStatus.OK);
      expect(await ThreadUse.countDocuments({ orderId: embroideryOrder.body.id })).toBe(1);
      const second = await api.post('/v1/production/iron-after/start').set(auth).send({ bundleBarcodes: ['BD-EM-1'], rackCode: 'BDL-RT', machineBarcode: 'MC-IR-2' }).expect(httpStatus.OK);
      expect(second.body[0].process).toBe('embroidery-thread-cut');
      const ironed = await api.post('/v1/production/iron-after/place').set(auth).send({ bundleBarcodes: ['BD-EM-1'], rackCode: 'BDL-RT-B' }).expect(httpStatus.OK);
      expect(ironed.body[0].process).toBe('iron-after');
      await api.post('/v1/production/iron/start').set(auth).send({ bundleBarcodes: ['BD-ST-1'], machineBarcode: 'MC-IR-2' }).expect(httpStatus.BAD_REQUEST);
      await api.post('/v1/production/sticker/start').set(auth).send({ bundleBarcodes: ['BD-ST-1'], rackCode: 'BDL-RT', machineBarcode: 'MC-ET-1' }).expect(httpStatus.OK);
      const stuck = await api.post('/v1/production/sticker/place').set(auth).send({ bundleBarcodes: ['BD-ST-1'], rackCode: 'BDL-RT-B' }).expect(httpStatus.OK);
      expect(stuck.body[0].process).toBe('sticker');
      expect(await ThreadUse.countDocuments({ orderId: stickerOrder.body.id })).toBe(0);
      await api.post('/v1/production/embroidery-thread-cut/start').set(auth).send({ bundleBarcodes: ['BD-ST-1'], rackCode: 'BDL-RT-B', machineBarcode: 'MC-ET-1' }).expect(httpStatus.BAD_REQUEST);
      const stickerIron = await api.post('/v1/production/iron-after/start').set(auth).send({ bundleBarcodes: ['BD-ST-1'], rackCode: 'BDL-RT-B', machineBarcode: 'MC-IR-2' }).expect(httpStatus.OK);
      expect(stickerIron.body[0].process).toBe('sticker');
      const stickerDone = await api.post('/v1/production/iron-after/place').set(auth).send({ bundleBarcodes: ['BD-ST-1'], rackCode: 'BDL-RT' }).expect(httpStatus.OK);
      expect(stickerDone.body[0].process).toBe('iron-after');
    },
    60000
  );

  test(
    'packing takes only the final-checking remainder and a second box stays on the rack',
    async () => {
      const category = await Category.create({ name: 'Pack cat' });
      const product = await Product.create({ name: 'Pack hanky', category: category.id });
      const style = await StyleCode.create({ styleCode: 'PK-60', eanCode: '8900000000060', mrp: 10, packingBundleQty: 60, linkedItem: product.id });
      product.styleCodes = [style.id];
      await product.save();
      const order = await api.post('/v1/production/orders').set(auth).send({ itemId: String(product.id), productionType: 'normal', revisionId: 'V1', targetQty: 130, priority: 'Medium' }).expect(httpStatus.CREATED);
      await StorageRack.create({ code: 'PK-WH', name: 'Pack rack', stockType: 'packing', barcode: 'PK-WH' });
      await StorageRack.create({ code: 'BDL-WH', name: 'Bundle rack', stockType: 'bundles', barcode: 'BDL-WH' });
      await StorageRack.create({ code: 'BOX-WH', name: 'Box rack', stockType: 'box', barcode: 'BOX-WH' });
      await PieceBundle.create({ orderId: order.body.id, number: 1, qty: 70, finalGood: 70, closed: true, barcode: 'BD-PK-1', rackCode: 'PK-WH', status: 'closed', process: 'broken', route: 'normal', checkedGood: true });
      await PieceBundle.create({ orderId: order.body.id, number: 2, qty: 60, finalGood: 60, closed: true, barcode: 'BD-PK-2', rackCode: 'PK-WH', status: 'closed', process: 'broken', route: 'normal', checkedGood: true });
      await PieceBundle.create({ orderId: order.body.id, number: 3, qty: 60, finalGood: 60, closed: true, barcode: 'BD-PK-3', rackCode: 'PK-WH', status: 'closed', process: 'broken', route: 'normal', checkedGood: true });
      const first = await PieceBundle.findOne({ barcode: 'BD-PK-1' });
      const second = await PieceBundle.findOne({ barcode: 'BD-PK-2' });
      await QualityResult.create({ eventId: 'final-checking-BD-PK-1', kind: 'final-checking', bundleId: String(first.id), orderId: String(order.body.id), goodQty: 70, rackCode: 'PK-WH' });
      await QualityResult.create({ eventId: 'final-checking-BD-PK-2', kind: 'final-checking', bundleId: String(second.id), orderId: String(order.body.id), goodQty: 60, rackCode: 'PK-WH' });

      const upcoming = await api.get('/v1/warehouse/packing/upcoming').set(auth).expect(httpStatus.OK);
      expect(upcoming.body.results.map((row) => row.barcode).sort()).toEqual(['BD-PK-1', 'BD-PK-2']);
      await api.post('/v1/warehouse/packing/pack').set(auth).send({ bundleBarcode: 'BD-PK-3', pieceCount: 60 }).expect(httpStatus.BAD_REQUEST);
      await api.post('/v1/warehouse/packing/pack').set(auth).send({ bundleBarcode: 'BD-PK-1', pieceCount: 40 }).expect(httpStatus.BAD_REQUEST);
      await api.post('/v1/warehouse/packing/pack').set(auth).send({ bundleBarcode: 'BD-PK-1', pieceCount: 80 }).expect(httpStatus.BAD_REQUEST);
      const packed = await api.post('/v1/warehouse/packing/pack').set(auth).send({ bundleBarcode: 'BD-PK-1', pieceCount: 60 }).expect(httpStatus.CREATED);
      expect(packed.body.barcode).toMatch(/^PB-/);
      expect((await PieceBundle.findOne({ barcode: 'BD-PK-1' })).packedQty).toBe(60);
      await api.post('/v1/warehouse/packing/pack').set(auth).send({ bundleBarcode: 'BD-PK-1', pieceCount: 20 }).expect(httpStatus.BAD_REQUEST);
      const rest = await api.post('/v1/warehouse/packing/pack').set(auth).send({ bundleBarcode: 'BD-PK-1', pieceCount: 10 }).expect(httpStatus.CREATED);
      const other = await api.post('/v1/warehouse/packing/pack').set(auth).send({ bundleBarcode: 'BD-PK-2', pieceCount: 60 }).expect(httpStatus.CREATED);

      const client = await api.post('/v1/warehouse/clients').set(auth).send({ name: 'Pack buyer', address: 'Jaipur' }).expect(httpStatus.CREATED);
      const clientOrder = await api.post('/v1/warehouse/orders').set(auth).send({ clientId: client.body.id, targetBoxes: 2 }).expect(httpStatus.CREATED);
      const box = await api.post('/v1/warehouse/packing/box').set(auth).send({ packingBundleBarcodes: [packed.body.barcode, rest.body.barcode], clientOrderId: clientOrder.body.id }).expect(httpStatus.CREATED);
      expect(box.body.status).toBe('open');
      expect(box.body.pieceQty).toBe(70);
      expect(box.body.scaleWeight).toBe(0);
      expect(box.body.packingBundleIds).toHaveLength(2);
      const box2 = await api.post('/v1/warehouse/packing/box').set(auth).send({ packingBundleBarcodes: [other.body.barcode], clientOrderId: clientOrder.body.id }).expect(httpStatus.CREATED);

      await api.post('/v1/warehouse/boxes/store').set(auth).send({ boxBarcode: box.body.barcode, rackCode: 'BOX-WH' }).expect(httpStatus.BAD_REQUEST);
      await api.post('/v1/warehouse/boxes/weigh').set(auth).send({ boxBarcode: box.body.barcode, scaleWeight: 0 }).expect(httpStatus.BAD_REQUEST);
      const weighed = await api.post('/v1/warehouse/boxes/weigh').set(auth).send({ boxBarcode: box.body.barcode, scaleWeight: 4.5 }).expect(httpStatus.OK);
      expect(weighed.body.status).toBe('weighed');
      await api.post('/v1/warehouse/boxes/store').set(auth).send({ boxBarcode: box.body.barcode, rackCode: 'BDL-WH' }).expect(httpStatus.BAD_REQUEST);
      const stored = await api.post('/v1/warehouse/boxes/store').set(auth).send({ boxBarcode: box.body.barcode, rackCode: 'BOX-WH' }).expect(httpStatus.OK);
      expect(stored.body.status).toBe('on-rack');
      expect(stored.body.rackCode).toBe('BOX-WH');
      await api.post('/v1/warehouse/dispatch/ship').set(auth).send({ boxBarcode: box2.body.barcode, vehicleNumber: 'RJ14', eventId: 'ship-open', site: 'factory' }).expect(httpStatus.BAD_REQUEST);
      await api.post('/v1/warehouse/boxes/weigh').set(auth).send({ boxBarcode: box2.body.barcode, scaleWeight: 3 }).expect(httpStatus.OK);
      await api.post('/v1/warehouse/boxes/store').set(auth).send({ boxBarcode: box2.body.barcode, rackCode: 'BOX-WH' }).expect(httpStatus.OK);

      const shipped = await api.post('/v1/warehouse/dispatch/ship').set(auth).send({ boxBarcode: box.body.barcode, vehicleNumber: 'RJ14 AB 1', eventId: 'ship-pk-1', site: 'factory' }).expect(httpStatus.OK);
      expect(shipped.body.status).toBe('dispatched');
      expect(shipped.body.vehicleNumber).toBe('RJ14 AB 1');
      expect(shipped.body.clientAddress).toBe('Jaipur');
      const again = await api.post('/v1/warehouse/dispatch/ship').set(auth).send({ boxBarcode: box.body.barcode, vehicleNumber: 'RJ14 AB 1', eventId: 'ship-pk-1', site: 'factory' }).expect(httpStatus.OK);
      expect(again.body.id).toBe(shipped.body.id);
      expect((await ClientOrder.findById(clientOrder.body.id)).status).toBe('partially-dispatched');
      expect((await DispatchBox.findOne({ barcode: box2.body.barcode })).status).toBe('on-rack');
      const movement = await StockMovement.findOne({ entityId: box.body.barcode, kind: 'dispatch' });
      expect(movement.fromLocation).toBe('BOX-WH');
      expect(movement.toLocation).toBe('dispatched');
    },
    60000
  );
});
