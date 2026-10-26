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
  buildFabricCountPayload,
  buildFabricMeasurementPayload,
  buildFabricQualityPayload,
  buildFabricTypePayload,
  buildFabricYarnPayload,
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
  const yarnRes = await api
    .post('/v1/fabric-yarns')
    .set(authHeader)
    .send(buildFabricYarnPayload({ name: "Test 60's" }))
    .expect(httpStatus.CREATED);
  const countRes = await api
    .post('/v1/fabric-counts')
    .set(authHeader)
    .send(buildFabricCountPayload({ name: 'Test 60COMPX60COMP' }))
    .expect(httpStatus.CREATED);
  const gsmMeasurementRes = await api
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
    yarnId: yarnRes.body.id,
    countId: countRes.body.id,
    gsmMeasurementId: gsmMeasurementRes.body.id,
    finishedWidthMeasurementId: widthMeasurementRes.body.id,
    typeName: typeRes.body.name,
    colorName: colorRes.body.name,
    qualityName: qualityRes.body.name,
    yarnName: yarnRes.body.name,
    countName: countRes.body.name,
    gsmMeasurementName: gsmMeasurementRes.body.name,
    widthMeasurementName: widthMeasurementRes.body.name,
  };
};

/**
 * Expected catalog name from the five lookup labels.
 * @param {object} lookups
 * @param {object} [overrides]
 * @returns {string}
 */
const expectedFabricName = (lookups, overrides = {}) =>
  [
    overrides.typeName ?? lookups.typeName,
    overrides.colorName ?? lookups.colorName,
    overrides.qualityName ?? lookups.qualityName,
    overrides.yarnName ?? lookups.yarnName,
    overrides.countName ?? lookups.countName,
  ]
    .map((part) => (part == null ? '' : String(part).trim()))
    .filter(Boolean)
    .join('-');

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

  test('FabricYarn: create, list, search, get, update, delete', async () => {
    const payload = buildFabricYarnPayload();
    await runFullCrudFlow({
      basePath: '/v1/fabric-yarns',
      createPayload: payload,
      updatePayload: { name: `${payload.name}-updated` },
      searchTerm: payload.name,
    });
  });

  test('FabricCount: create, list, search, get, update, delete', async () => {
    const payload = buildFabricCountPayload();
    await runFullCrudFlow({
      basePath: '/v1/fabric-counts',
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
    const payload = buildFabricCatalogPayload(lookups, { name: 'Manual Name Should Be Ignored' });

    const createRes = await api
      .post('/v1/fabric-catalogs')
      .set(authHeader)
      .send(payload)
      .expect(httpStatus.CREATED);

    expect(createRes.body.name).toBe(expectedFabricName(lookups));
    expect(createRes.body.fabricTypeName).toBe(lookups.typeName);
    expect(createRes.body.colourName).toBe(lookups.colorName);
    expect(createRes.body.qualityName).toBe(lookups.qualityName);
    expect(createRes.body.yarnName).toBe(lookups.yarnName);
    expect(createRes.body.countName).toBe(lookups.countName);
    expect(createRes.body.millOldFabricSortNo).toBe('17223');
    expect(createRes.body.millNewFabricSortNo).toBe('AW0017223AB0586');
    expect(createRes.body.gsmMeasurementName).toBe(lookups.gsmMeasurementName);
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

    expect(createRes.body.name).toBe(expectedFabricName(lookups));
    expect(createRes.body.design).toBe('Plain');
    expect(createRes.body.wash).toBe('Yes');
    expect(createRes.body.finish).toBe('NA');

    const updateRes = await api
      .patch(`/v1/fabric-catalogs/${createRes.body.id}`)
      .set(authHeader)
      .send({ design: 'Print', wash: 'No', finish: 'Silverdor', name: 'Still Ignored' })
      .expect(httpStatus.OK);

    expect(updateRes.body.name).toBe(expectedFabricName(lookups));
    expect(updateRes.body.design).toBe('Print');
    expect(updateRes.body.wash).toBe('No');
    expect(updateRes.body.finish).toBe('Silverdor');
  });

  test('FabricCatalog: regenerates name when a lookup changes', async () => {
    const lookups = await createFabricLookups();
    const payload = buildFabricCatalogPayload(lookups);

    const createRes = await api
      .post('/v1/fabric-catalogs')
      .set(authHeader)
      .send(payload)
      .expect(httpStatus.CREATED);

    const typeRes = await api
      .post('/v1/fabric-types')
      .set(authHeader)
      .send(buildFabricTypePayload({ name: 'Renamed Voile' }))
      .expect(httpStatus.CREATED);

    const updateRes = await api
      .patch(`/v1/fabric-catalogs/${createRes.body.id}`)
      .set(authHeader)
      .send({ fabricType: typeRes.body.id })
      .expect(httpStatus.OK);

    expect(updateRes.body.fabricTypeName).toBe('Renamed Voile');
    expect(updateRes.body.name).toBe(expectedFabricName(lookups, { typeName: 'Renamed Voile' }));
  });

  test('FabricCatalog: rejects create when no name lookups are set', async () => {
    const payload = buildFabricCatalogPayload(
      {},
      {
        name: '',
        fabricType: null,
        color: null,
        quality: null,
        yarn: null,
        count: null,
      }
    );

    const res = await api.post('/v1/fabric-catalogs').set(authHeader).send(payload).expect(httpStatus.BAD_REQUEST);
    expect(res.body.message).toBe('Set at least one of fabric type, color, quality, yarn, or count');
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

  const ensureStitchTypeAttribute = async () => {
    await api
      .post('/v1/product-attributes')
      .set(authHeader)
      .send({
        name: 'Stitch type',
        attributeType: 'Manufacturing',
        type: 'select',
        required: false,
        optionValues: [
          { name: 'Hem 1', sortOrder: 1 },
          { name: 'Hem 2', sortOrder: 2 },
          { name: 'Hem 3', sortOrder: 3 },
          { name: 'Hem 4', sortOrder: 4 },
        ],
      })
      .expect(httpStatus.CREATED);
  };

  test('FabricCatalog: optional stitchType empty and valid Hem value', async () => {
    await ensureStitchTypeAttribute();
    const lookups = await createFabricLookups();

    const emptyRes = await api
      .post('/v1/fabric-catalogs')
      .set(authHeader)
      .send(buildFabricCatalogPayload(lookups, { stitchType: '' }))
      .expect(httpStatus.CREATED);
    expect(emptyRes.body.stitchType).toBe('');

    const createRes = await api
      .post('/v1/fabric-catalogs')
      .set(authHeader)
      .send(buildFabricCatalogPayload(lookups, { stitchType: 'hem 2' }))
      .expect(httpStatus.CREATED);
    expect(createRes.body.stitchType).toBe('Hem 2');

    const searchRes = await api
      .get('/v1/fabric-catalogs')
      .set(authHeader)
      .query({ search: 'Hem 2', limit: 50 })
      .expect(httpStatus.OK);
    expect(searchRes.body.results).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: createRes.body.id, stitchType: 'Hem 2' })])
    );

    const updateRes = await api
      .patch(`/v1/fabric-catalogs/${createRes.body.id}`)
      .set(authHeader)
      .send({ stitchType: 'Hem 4' })
      .expect(httpStatus.OK);
    expect(updateRes.body.stitchType).toBe('Hem 4');
  });

  test('FabricCatalog: rejects invalid stitchType', async () => {
    await ensureStitchTypeAttribute();
    const lookups = await createFabricLookups();
    const payload = buildFabricCatalogPayload(lookups, { stitchType: 'Hem 99' });

    await api.post('/v1/fabric-catalogs').set(authHeader).send(payload).expect(httpStatus.BAD_REQUEST);
  });
});
