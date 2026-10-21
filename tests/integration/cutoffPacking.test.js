import mongoose from 'mongoose';
import request from 'supertest';
import httpStatus from 'http-status';
import moment from 'moment';
import app from '../utils/factoryTestApp';
import setupTestDB from '../utils/setupTestDB';
import { insertUsers, admin } from '../fixtures/user.fixture';
import config from '../../src/config/config.js';
import { tokenTypes } from '../../src/config/tokens.js';
import { generateToken } from '../../src/services/token.service.js';
import { getDefaultNavigationByRole } from '../../src/utils/navigationHelper.js';
import FabricCatalog from '../../src/models/fabricCatalog.model.js';

setupTestDB();

const api = request(app);
const superId = new mongoose.Types.ObjectId();
const auth = {
  Authorization: `Bearer ${generateToken(superId, moment().add(config.jwt.accessExpirationMinutes, 'minutes'), tokenTypes.ACCESS)}`,
};

beforeEach(async () => {
  await insertUsers([
    { ...admin, navigation: getDefaultNavigationByRole('admin') },
    {
      _id: superId,
      name: 'Super',
      email: 'cutoff-super@addon.test',
      password: 'password1',
      role: 'super_admin',
      navigation: getDefaultNavigationByRole('super_admin'),
    },
  ]);
});

/**
 * Packing number payload shared by the partial-cutoff cases.
 * @param {string} lotId
 * @param {string} code
 * @param {string[]} [lineIds]
 */
function packBody(lotId, code, lineIds) {
  return {
    lotId,
    lineIds,
    packingListCode: code,
    shipmentDate: new Date().toISOString(),
    expectedDelivery: new Date().toISOString(),
    rolls: 1,
    quantity: 10,
    weight: 4,
  };
}

describe('Per-line fabric cutoff', () => {
  test('an approved line can ship and be received while another cutoff is still rejected', async () => {
    const cambric = await FabricCatalog.create({ name: 'Cambric', fabricSortNo: 'CUT-CAMBRIC', rate: 8 });
    const voile = await FabricCatalog.create({ name: 'Voile', fabricSortNo: 'CUT-VOILE', rate: 9 });
    const po = await api
      .post('/v1/store/purchase-orders')
      .set(auth)
      .send({
        supplierName: 'Mill C',
        lines: [
          { lineId: 'L2', fabricId: String(voile._id), fabricName: 'Voile', quantity: 12, rate: 9, gstPercent: 5 },
          { lineId: 'L1', fabricId: String(cambric._id), fabricName: 'Cambric', quantity: 10, rate: 8, gstPercent: 5 },
        ],
      })
      .expect(httpStatus.CREATED);
    await api.post(`/v1/store/purchase-orders/${po.body.id}/submit`).set(auth).expect(httpStatus.OK);
    const lot = await api
      .post('/v1/store/lots')
      .set(auth)
      .send({ poId: po.body.id, cutoffs: [{ fabricId: String(cambric._id) }, { fabricId: String(voile._id) }] })
      .expect(httpStatus.CREATED);
    const decided = await api
      .post(`/v1/store/lots/${lot.body.id}/cutoffs`)
      .set(auth)
      .send({
        decisions: [
          { fabricId: String(cambric._id), approved: true },
          { fabricId: String(voile._id), approved: false },
        ],
      })
      .expect(httpStatus.OK);
    expect(decided.body.status).toBe('pending-cutoff');

    const both = await api.post('/v1/store/packing-lists').set(auth).send(packBody(lot.body.id, 'PL-BOTH', ['L1', 'L2'])).expect(httpStatus.BAD_REQUEST);
    expect(both.body.message).toBe('Cutoff is not approved');
    const unnamed = await api.post('/v1/store/packing-lists').set(auth).send(packBody(lot.body.id, 'PL-NONE')).expect(httpStatus.BAD_REQUEST);
    expect(unnamed.body.message).toBe('Packing list needs an approved lot');

    const packed = await api.post('/v1/store/packing-lists').set(auth).send(packBody(lot.body.id, 'PL-L1', ['L1'])).expect(httpStatus.CREATED);
    const patched = await api
      .patch(`/v1/store/packing-lists/${packed.body.id}`)
      .set(auth)
      .send({ lineIds: ['L2'] })
      .expect(httpStatus.BAD_REQUEST);
    expect(patched.body.message).toBe('Cutoff is not approved');

    const wrongRoll = await api
      .post('/v1/store/receipts')
      .set(auth)
      .send({ lotId: lot.body.id, rolls: [{ scaleWeight: 3, fabricId: String(voile._id) }] })
      .expect(httpStatus.BAD_REQUEST);
    expect(wrongRoll.body.message).toBe('Cutoff is not approved');
    const unnamedRoll = await api
      .post('/v1/store/receipts')
      .set(auth)
      .send({ lotId: lot.body.id, rolls: [{ scaleWeight: 3 }] })
      .expect(httpStatus.BAD_REQUEST);
    expect(unnamedRoll.body.message).toBe('A lot with one rejected cutoff cannot be received');

    const receipt = await api
      .post('/v1/store/receipts')
      .set(auth)
      .send({ lotId: lot.body.id, eventId: 'grn-partial-cutoff', rolls: [{ scaleWeight: 3, fabricId: String(cambric._id) }] })
      .expect(httpStatus.CREATED);
    expect(receipt.body.rolls).toHaveLength(1);
    expect(receipt.body.rolls[0].rate).toBe(8);
  });
});
