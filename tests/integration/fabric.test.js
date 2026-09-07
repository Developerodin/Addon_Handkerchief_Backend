import request from 'supertest';
import httpStatus from 'http-status';
import app from '../utils/catalogTestApp';
import setupTestDB from '../utils/setupTestDB';
import { insertUsers, admin } from '../fixtures/user.fixture';
import { adminAccessToken } from '../fixtures/token.fixture';
import { getDefaultNavigationByRole } from '../../src/utils/navigationHelper.js';
import {
  buildFabricCatalogPayload,
  buildFabricColorPayload,
  buildFabricMeasurementPayload,
  buildFabricQualityPayload,
  buildFabricTypePayload,
  buildFabricYarnCountPayload,
} from '../fixtures/fabric.fixture';

setupTestDB();

const api = request(app);
const authHeader = { Authorization: `Bearer ${adminAccessToken}` };

beforeEach(async () => {
  await insertUsers([{ ...admin, navigation: getDefaultNavigationByRole('admin') }]);
});

const runFullCrudFlow = async ({
  basePath,
  createPayload,
  updatePayload,
  searchTerm,
  idField = 'id',
}) => {
  const createRes = await api.post(basePath).set(authHeader).send(createPayload).expect(httpStatus.CREATED);
  const createdId = createRes.body[idField];
  expect(createdId).toBeDefined();

  const listRes = await api.get(basePath).set(authHeader).query({ limit: 50 }).expect(httpStatus.OK);
  expect(listRes.body.results).toEqual(
    expect.arrayContaining([expect.objectContaining({ [idField]: createdId })])
  );

  if (searchTerm) {
    const searchRes = await api
      .get(basePath)
      .set(authHeader)
      .query({ search: searchTerm, limit: 50 })
      .expect(httpStatus.OK);
    expect(searchRes.body.results).toEqual(
      expect.arrayContaining([expect.objectContaining({ [idField]: createdId })])
    );
  }

  await api.get(`${basePath}/${createdId}`).set(authHeader).expect(httpStatus.OK);

  const updateRes = await api
    .patch(`${basePath}/${createdId}`)
    .set(authHeader)
    .send(updatePayload)
    .expect(httpStatus.OK);
  Object.entries(updatePayload).forEach(([key, value]) => {
    expect(updateRes.body[key]).toBe(value);
  });

  await api.delete(`${basePath}/${createdId}`).set(authHeader).expect(httpStatus.NO_CONTENT);
  await api.get(`${basePath}/${createdId}`).set(authHeader).expect(httpStatus.NOT_FOUND);

  const afterDeleteList = await api.get(basePath).set(authHeader).query({ limit: 100 }).expect(httpStatus.OK);
  const ids = (afterDeleteList.body.results || []).map((row) => row[idField]);
  expect(ids).not.toContain(createdId);
};

const createFabricLookups = async () => {
  const typeRes = await api
    .post('/v1/fabric-types')
    .set(authHeader)
    .send(buildFabricTypePayload({ name: 'Test Voile' }))
    .expect(httpStatus.CREATED);
  const colorRes = await api
    .post('/v1/fabric-colors')
    .set(authHeader)
    .send(buildFabricColorPayload({ name: 'Test White', colorCode: '#FFFFFF' }))
    .expect(httpStatus.CREATED);
  const qualityRes = await api
    .post('/v1/fabric-qualities')
    .set(authHeader)
    .send(buildFabricQualityPayload({ name: 'Test Premium' }))
    .expect(httpStatus.CREATED);
  const yarnCountRes = await api
    .post('/v1/fabric-yarn-counts')
    .set(authHeader)
    .send(buildFabricYarnCountPayload({ name: "Test 60's" }))
    .expect(httpStatus.CREATED);
  const glmMeasurementRes = await api
    .post('/v1/fabric-measurements')
    .set(authHeader)
    .send(buildFabricMeasurementPayload({ name: 'Test GSM', symbol: 'gsm', category: 'weight' }))
    .expect(httpStatus.CREATED);
  const widthMeasurementRes = await api
    .post('/v1/fabric-measurements')
    .set(authHeader)
    .send(buildFabricMeasurementPayload({ name: 'Test Inch', symbol: 'in', category: 'length' }))
    .expect(httpStatus.CREATED);

  return {
    fabricTypeId: typeRes.body.id,
    colorId: colorRes.body.id,
    qualityId: qualityRes.body.id,
    yarnCountId: yarnCountRes.body.id,
    glmMeasurementId: glmMeasurementRes.body.id,
    finishedWidthMeasurementId: widthMeasurementRes.body.id,
    typeName: typeRes.body.name,
    colorName: colorRes.body.name,
    qualityName: qualityRes.body.name,
    yarnCountName: yarnCountRes.body.name,
    glmMeasurementName: glmMeasurementRes.body.name,
    widthMeasurementName: widthMeasurementRes.body.name,
  };
};

describe('Fabric Master API — sub-masters and catalog', () => {
  test('FabricType: create, list, search, get, update, delete', async () => {
    const payload = buildFabricTypePayload();
    await runFullCrudFlow({
      basePath: '/v1/fabric-types',
      createPayload: payload,
      updatePayload: { name: `${payload.name}-updated` },
      searchTerm: payload.name,
    });
  });

  test('FabricColor: create, list, search, get, update, delete', async () => {
    const payload = buildFabricColorPayload();
    await runFullCrudFlow({
      basePath: '/v1/fabric-colors',
      createPayload: payload,
      updatePayload: { pantone: 'PMS-White' },
      searchTerm: payload.name,
    });
  });

  test('FabricQuality: create, list, search, get, update, delete', async () => {
    const payload = buildFabricQualityPayload();
    await runFullCrudFlow({
      basePath: '/v1/fabric-qualities',
      createPayload: payload,
      updatePayload: { grade: 'A' },
      searchTerm: payload.name,
    });
  });

  test('FabricYarnCount: create, list, search, get, update, delete', async () => {
    const payload = buildFabricYarnCountPayload();
    await runFullCrudFlow({
      basePath: '/v1/fabric-yarn-counts',
      createPayload: payload,
      updatePayload: { name: `${payload.name}-updated` },
      searchTerm: payload.name,
    });
  });

  test('FabricMeasurement: create, list, search, get, update, delete', async () => {
    const payload = buildFabricMeasurementPayload();
    await runFullCrudFlow({
      basePath: '/v1/fabric-measurements',
      createPayload: payload,
      updatePayload: { symbol: 'test-u' },
      searchTerm: payload.name,
    });
  });

  test('FabricCatalog: create with lookups and denormalized names', async () => {
    const lookups = await createFabricLookups();
    const payload = buildFabricCatalogPayload(lookups);

    const createRes = await api
      .post('/v1/fabric-catalogs')
      .set(authHeader)
      .send(payload)
      .expect(httpStatus.CREATED);

    expect(createRes.body.fabricTypeName).toBe(lookups.typeName);
    expect(createRes.body.colourName).toBe(lookups.colorName);
    expect(createRes.body.qualityName).toBe(lookups.qualityName);
    expect(createRes.body.yarnCountName).toBe(lookups.yarnCountName);
    expect(createRes.body.glmMeasurementName).toBe(lookups.glmMeasurementName);
    expect(createRes.body.finishedWidthMeasurementName).toBe(lookups.widthMeasurementName);
  });

  test('FabricCatalog: design, wash, finish create and update', async () => {
    const lookups = await createFabricLookups();
    const payload = buildFabricCatalogPayload(lookups, {
      design: 'Plain',
      wash: 'Yes',
      finish: 'NA',
    });

    const createRes = await api
      .post('/v1/fabric-catalogs')
      .set(authHeader)
      .send(payload)
      .expect(httpStatus.CREATED);

    expect(createRes.body.design).toBe('Plain');
    expect(createRes.body.wash).toBe('Yes');
    expect(createRes.body.finish).toBe('NA');

    const updateRes = await api
      .patch(`/v1/fabric-catalogs/${createRes.body.id}`)
      .set(authHeader)
      .send({ design: 'Print', wash: 'No', finish: 'Silverdor' })
      .expect(httpStatus.OK);

    expect(updateRes.body.design).toBe('Print');
    expect(updateRes.body.wash).toBe('No');
    expect(updateRes.body.finish).toBe('Silverdor');
  });

  test('FabricCatalog: rejects invalid finish enum', async () => {
    const lookups = await createFabricLookups();
    const payload = buildFabricCatalogPayload(lookups, { finish: 'Gold' });

    await api.post('/v1/fabric-catalogs').set(authHeader).send(payload).expect(httpStatus.BAD_REQUEST);
  });

  test('FabricCatalog: optional design, wash, finish default to empty', async () => {
    const lookups = await createFabricLookups();
    const payload = buildFabricCatalogPayload(lookups, {
      design: '',
      wash: '',
      finish: '',
    });

    const createRes = await api
      .post('/v1/fabric-catalogs')
      .set(authHeader)
      .send(payload)
      .expect(httpStatus.CREATED);

    expect(createRes.body.design).toBe('');
    expect(createRes.body.wash).toBe('');
    expect(createRes.body.finish).toBe('');
  });
});
