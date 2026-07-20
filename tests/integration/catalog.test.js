import request from 'supertest';
import httpStatus from 'http-status';
import app from '../utils/catalogTestApp';
import setupTestDB from '../utils/setupTestDB';
import { insertUsers, admin } from '../fixtures/user.fixture';
import { adminAccessToken } from '../fixtures/token.fixture';
import { getDefaultNavigationByRole } from '../../src/utils/navigationHelper.js';
import {
  buildAttributePayload,
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
    const searchRes = await api.get(basePath).set(authHeader).query({ search: searchTerm, limit: 50 }).expect(httpStatus.OK);
    expect(searchRes.body.results).toEqual(
      expect.arrayContaining([expect.objectContaining({ [idField]: createdId })])
    );
  }

  await api.get(`${basePath}/${createdId}`).set(authHeader).expect(httpStatus.OK);

  const updateRes = await api.patch(`${basePath}/${createdId}`).set(authHeader).send(updatePayload).expect(httpStatus.OK);
  Object.entries(updatePayload).forEach(([key, value]) => {
    expect(updateRes.body[key]).toBe(value);
  });

  await api.delete(`${basePath}/${createdId}`).set(authHeader).expect(httpStatus.NO_CONTENT);
  await api.get(`${basePath}/${createdId}`).set(authHeader).expect(httpStatus.NOT_FOUND);

  const afterDeleteList = await api.get(basePath).set(authHeader).query({ limit: 100 }).expect(httpStatus.OK);
  const ids = (afterDeleteList.body.results || []).map((row) => row[idField]);
  expect(ids).not.toContain(createdId);
};

describe('Master Catalog API — sidebar modules', () => {
  test('Categories: create, list, search, get, update, delete', async () => {
    const payload = buildCategoryPayload();
    await runFullCrudFlow({
      basePath: '/v1/categories',
      createPayload: payload,
      updatePayload: { description: 'Updated category description' },
      searchTerm: payload.name,
    });
  });

  test('Attributes: create, list, search, get, update, delete', async () => {
    const payload = buildAttributePayload();
    await runFullCrudFlow({
      basePath: '/v1/product-attributes',
      createPayload: payload,
      updatePayload: { name: `${payload.name}-updated` },
      searchTerm: payload.name,
    });
  });

  test('Raw Material: create, list, search, get, update, delete', async () => {
    const payload = buildRawMaterialPayload();
    await runFullCrudFlow({
      basePath: '/v1/raw-materials',
      createPayload: payload,
      updatePayload: { description: 'Updated raw material description' },
      searchTerm: payload.name,
    });
  });

  test('Processes: create, list, search, get, update, delete', async () => {
    const payload = buildProcessPayload();
    await runFullCrudFlow({
      basePath: '/v1/processes',
      createPayload: payload,
      updatePayload: { description: 'Updated process description' },
      searchTerm: payload.name,
    });
  });

  test('Style Codes: create, list, search, get, update, delete', async () => {
    const payload = buildStyleCodePayload();
    await runFullCrudFlow({
      basePath: '/v1/style-codes',
      createPayload: payload,
      updatePayload: { brand: 'Updated Brand' },
      searchTerm: payload.styleCode,
    });
  });

  test('Items: create with linked catalog data, list, search, get, update, delete', async () => {
    const categoryRes = await api.post('/v1/categories').set(authHeader).send(buildCategoryPayload()).expect(httpStatus.CREATED);
    const styleCodeRes = await api.post('/v1/style-codes').set(authHeader).send(buildStyleCodePayload()).expect(httpStatus.CREATED);
    const processRes = await api.post('/v1/processes').set(authHeader).send(buildProcessPayload()).expect(httpStatus.CREATED);
    const rawMaterialRes = await api.post('/v1/raw-materials').set(authHeader).send(buildRawMaterialPayload()).expect(httpStatus.CREATED);

    const payload = buildProductPayload({
      categoryId: categoryRes.body.id,
      styleCodeId: styleCodeRes.body.id,
      processId: processRes.body.id,
      rawMaterialId: rawMaterialRes.body.id,
    });

    const createRes = await api.post('/v1/products').set(authHeader).send(payload).expect(httpStatus.CREATED);
    const productId = createRes.body.id;
    expect(productId).toBeDefined();
    expect(createRes.body.name).toBe(payload.name);

    const listRes = await api.get('/v1/products').set(authHeader).query({ search: payload.name, limit: 20 }).expect(httpStatus.OK);
    expect(listRes.body.results).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: productId, name: payload.name })])
    );

    await api.get(`/v1/products/${productId}`).set(authHeader).expect(httpStatus.OK);

    const updateRes = await api
      .patch(`/v1/products/${productId}`)
      .set(authHeader)
      .send({ description: 'Updated product description' })
      .expect(httpStatus.OK);
    expect(updateRes.body.description).toBe('Updated product description');

    await api.delete(`/v1/products/${productId}`).set(authHeader).expect(httpStatus.NO_CONTENT);
    await api.get(`/v1/products/${productId}`).set(authHeader).expect(httpStatus.NOT_FOUND);
  });

  test('Style Codes bulk-import should create records', async () => {
    const styleCodes = [buildStyleCodePayload(), buildStyleCodePayload()];
    const res = await api.post('/v1/style-codes/bulk-import').set(authHeader).send({ styleCodes }).expect(httpStatus.OK);

    expect(res.body.total).toBe(2);
    expect(res.body.created + res.body.updated).toBeGreaterThanOrEqual(1);
  });

  test('Items bulk-export should return an array', async () => {
    const categoryRes = await api.post('/v1/categories').set(authHeader).send(buildCategoryPayload()).expect(httpStatus.CREATED);
    await api
      .post('/v1/products')
      .set(authHeader)
      .send(buildProductPayload({ categoryId: categoryRes.body.id }))
      .expect(httpStatus.CREATED);

    const res = await api.get('/v1/products/bulk-export').set(authHeader).expect(httpStatus.OK);
    expect(Array.isArray(res.body.products)).toBe(true);
    expect(res.body.total).toBeGreaterThanOrEqual(1);
  });
});
