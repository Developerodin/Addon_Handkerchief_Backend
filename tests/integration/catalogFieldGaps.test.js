import mongoose from 'mongoose';
import request from 'supertest';
import httpStatus from 'http-status';
import app from '../utils/catalogTestApp';
import setupTestDB from '../utils/setupTestDB';
import { insertUsers, admin } from '../fixtures/user.fixture';
import { adminAccessToken } from '../fixtures/token.fixture';
import { getDefaultNavigationByRole } from '../../src/utils/navigationHelper.js';
import {
  buildCategoryPayload,
  buildProcessPayload,
  buildProductPayload,
  buildRawMaterialPayload,
  buildStyleCodePayload,
} from '../fixtures/catalog.fixture';

setupTestDB();

const api = request(app);
const authHeader = { Authorization: `Bearer ${adminAccessToken}` };

beforeEach(async () => {
  await insertUsers([{ ...admin, navigation: getDefaultNavigationByRole('admin') }]);
});

describe('Catalog field gaps', () => {
  test('item fields round-trip and an existing production type still saves', async () => {
    const categoryRes = await api.post('/v1/categories').set(authHeader).send(buildCategoryPayload()).expect(httpStatus.CREATED);
    const styleRes = await api.post('/v1/style-codes').set(authHeader).send(buildStyleCodePayload()).expect(httpStatus.CREATED);
    const rawRes = await api.post('/v1/raw-materials').set(authHeader).send(buildRawMaterialPayload()).expect(httpStatus.CREATED);
    const fabricCatalogId = new mongoose.Types.ObjectId().toString();
    const bomLineId = 'line-stable-1';

    const legacy = buildProductPayload({
      categoryId: categoryRes.body.id,
      styleCodeId: styleRes.body.id,
    });
    const legacyRes = await api.post('/v1/products').set(authHeader).send(legacy).expect(httpStatus.CREATED);
    expect(legacyRes.body.productionType).toBe('normal');
    expect(legacyRes.body.piecesPerCut).toBe(3);

    const payload = buildProductPayload({
      categoryId: categoryRes.body.id,
      styleCodeId: styleRes.body.id,
      rawMaterialId: rawRes.body.id,
      overrides: {
        productionType: 'sticker',
        piecesPerCut: 4,
        vendorName: 'Mill A',
        bom: [{ fabricCatalogId, bomLineId, quantity: 1.5, unitCost: 10, fabricName: 'Voile' }],
        rawMaterials: [{ rawMaterialId: rawRes.body.id, quantity: 2, unitCost: 1, materialRole: 'sewing-thread' }],
      },
    });

    const created = await api.post('/v1/products').set(authHeader).send(payload).expect(httpStatus.CREATED);
    expect(created.body.productionType).toBe('sticker');
    expect(created.body.piecesPerCut).toBe(4);
    expect(created.body.vendorName).toBe('Mill A');
    expect(created.body.bom[0].bomLineId).toBe(bomLineId);
    expect(created.body.rawMaterials[0].materialRole).toBe('sewing-thread');

    const fetched = await api.get(`/v1/products/${created.body.id}`).set(authHeader).expect(httpStatus.OK);
    expect(fetched.body.productionType).toBe('sticker');
    expect(fetched.body.bom[0].bomLineId).toBe(bomLineId);

    await api
      .post('/v1/products')
      .set(authHeader)
      .send(buildProductPayload({ categoryId: categoryRes.body.id, overrides: { piecesPerCut: 5 } }))
      .expect(httpStatus.BAD_REQUEST);
  });

  test('style, process, machine, rack, container, label, and device fields round-trip', async () => {
    const style = await api
      .post('/v1/style-codes')
      .set(authHeader)
      .send(buildStyleCodePayload({ packingBundleQty: 90 }))
      .expect(httpStatus.CREATED);
    expect(style.body.packingBundleQty).toBe(90);
    expect(style.body.bundleQty).toBe(60);
    expect(style.body.cartonQty).toBe(120);

    await api
      .post('/v1/style-codes')
      .set(authHeader)
      .send(buildStyleCodePayload({ packingBundleQty: 50 }))
      .expect(httpStatus.BAD_REQUEST);

    const process = await api
      .post('/v1/processes')
      .set(authHeader)
      .send(buildProcessPayload({ threadConsuming: true }))
      .expect(httpStatus.CREATED);
    expect(process.body.threadConsuming).toBe(true);

    const worker = await api
      .post('/v1/workers')
      .set(authHeader)
      .send({ name: 'Operator One', employeeCode: `EMP-${Date.now()}` })
      .expect(httpStatus.CREATED);

    const machine = await api
      .post('/v1/machines')
      .set(authHeader)
      .send({
        name: 'Cutter 1',
        code: `MC-${Date.now()}`,
        barcode: `BC-${Date.now()}`,
        assignedOperator: worker.body.id,
      })
      .expect(httpStatus.CREATED);
    expect(machine.body.barcode).toBeTruthy();
    expect(String(machine.body.assignedOperator)).toBe(worker.body.id);

    await api
      .post('/v1/machines')
      .set(authHeader)
      .send({ name: 'Cutter 2', code: `MC2-${Date.now()}`, barcode: machine.body.barcode })
      .expect(httpStatus.BAD_REQUEST);

    const rack = await api
      .post('/v1/storage-racks')
      .set(authHeader)
      .send({ code: `RK-${Date.now()}`, name: 'Reject rack', stockType: 'rejection' })
      .expect(httpStatus.CREATED);
    expect(rack.body.stockType).toBe('rejection');

    const container = await api
      .post('/v1/containers')
      .set(authHeader)
      .send({ code: `CT-${Date.now()}`, name: 'Piece bin', type: 'pieces' })
      .expect(httpStatus.CREATED);
    expect(container.body.type).toBe('pieces');

    const label = await api
      .post('/v1/label-templates')
      .set(authHeader)
      .send({ name: 'Piece label', labelType: 'piece' })
      .expect(httpStatus.CREATED);
    expect(label.body.labelType).toBe('piece');

    const device = await api
      .post('/v1/device-registry')
      .set(authHeader)
      .send({ name: 'Floor scale', deviceType: 'scale' })
      .expect(httpStatus.CREATED);
    expect(device.body.deviceType).toBe('scale');
  });
});
