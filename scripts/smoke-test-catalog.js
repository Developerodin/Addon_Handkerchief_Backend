#!/usr/bin/env node
/**
 * Smoke test for Master Catalog APIs (all sidebar modules).
 *
 * Usage:
 *   node scripts/smoke-test-catalog.js
 *   API_BASE_URL=http://localhost:5000/v1 node scripts/smoke-test-catalog.js
 *
 * Requires backend running and MongoDB reachable.
 */

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:5000/v1';
const suffix = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const log = (msg) => console.log(`[catalog-smoke] ${msg}`);
const fail = (msg) => {
  console.error(`[catalog-smoke] FAIL: ${msg}`);
  process.exit(1);
};

async function request(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  let data = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  return { status: res.status, data };
}

async function crudModule(name, basePath, createBody, updateBody, searchTerm) {
  log(`Testing ${name}`);

  const created = await request(basePath, { method: 'POST', body: createBody });
  if (created.status !== 201 || !created.data?.id) fail(`${name}: create failed (${created.status})`);
  const id = created.data.id;

  const listed = await request(`${basePath}?search=${encodeURIComponent(searchTerm)}&limit=50`);
  if (listed.status !== 200) fail(`${name}: list failed (${listed.status})`);
  const foundInList = (listed.data?.results || []).some((row) => row.id === id);
  if (!foundInList) fail(`${name}: created record missing from list/search`);

  const fetched = await request(`${basePath}/${id}`);
  if (fetched.status !== 200 || fetched.data?.id !== id) fail(`${name}: get by id failed`);

  const updated = await request(`${basePath}/${id}`, { method: 'PATCH', body: updateBody });
  if (updated.status !== 200) fail(`${name}: update failed (${updated.status})`);

  const deleted = await request(`${basePath}/${id}`, { method: 'DELETE' });
  if (deleted.status !== 204) fail(`${name}: delete failed (${deleted.status})`);

  const missing = await request(`${basePath}/${id}`);
  if (missing.status !== 404) fail(`${name}: record still exists after delete`);

  log(`PASS ${name}`);
  return id;
}

async function main() {
  log(`API base: ${API_BASE_URL}`);

  const categoryName = `Category ${suffix()}`;
  const categoryId = await crudModule(
    'Categories',
    '/categories',
    { name: categoryName, status: 'active' },
    { description: 'Updated by smoke test' },
    categoryName
  );

  const attributeName = `Attribute ${suffix()}`;
  await crudModule(
    'Attributes',
    '/product-attributes',
    {
      name: attributeName,
      attributeType: 'Manufacturing',
      type: 'select',
      optionValues: [{ name: 'Option A' }],
    },
    { name: `${attributeName}-updated` },
    attributeName
  );

  const rawMaterialName = `Raw Material ${suffix()}`;
  await crudModule(
    'Raw Material',
    '/raw-materials',
    {
      name: rawMaterialName,
      groupName: 'Smoke Group',
      type: 'Yarn',
      description: 'Smoke raw material',
      brand: 'Brand',
      countSize: '30s',
      material: 'Cotton',
      color: 'White',
      shade: 'Natural',
      unit: 'Kg',
      mrp: '100',
      hsnCode: '5201',
      gst: '5',
      articleNo: `ART-${suffix()}`,
    },
    { description: 'Updated raw material' },
    rawMaterialName
  );

  const processName = `Process ${suffix()}`;
  await crudModule(
    'Processes',
    '/processes',
    {
      name: processName,
      type: 'Knitting',
      description: 'Smoke process',
      steps: [{ stepTitle: 'Step 1', stepDescription: 'Do work', duration: 5 }],
    },
    { description: 'Updated process' },
    processName
  );

  const styleCode = `SC-${suffix()}`;
  await crudModule(
    'Style Codes',
    '/style-codes',
    {
      styleCode,
      eanCode: `EAN${suffix()}`,
      mrp: 199,
      brand: 'Smoke Brand',
      status: 'active',
    },
    { brand: 'Updated Brand' },
    styleCode
  );

  log('Testing Items');
  const productName = `Product ${suffix()}`;
  const productCreate = await request('/products', {
    method: 'POST',
    body: {
      name: productName,
      softwareCode: `SW-${suffix()}`,
      category: categoryId,
      productionType: 'internal',
      status: 'active',
    },
  });
  if (productCreate.status !== 201 || !productCreate.data?.id) {
    fail(`Items: create failed (${productCreate.status})`);
  }
  const productId = productCreate.data.id;

  const productDelete = await request(`/products/${productId}`, { method: 'DELETE' });
  if (productDelete.status !== 204) fail(`Items: delete failed (${productDelete.status})`);

  log('PASS Items');
  log('All Master Catalog sidebar modules passed smoke test.');
}

main().catch((err) => {
  console.error('[catalog-smoke] ERROR', err);
  process.exit(1);
});
