import faker from 'faker';

const suffix = () => `${Date.now()}-${faker.random.alphaNumeric(6)}`;

export const buildFabricTypePayload = (overrides = {}) => ({
  name: `Fabric Type ${suffix()}`,
  status: 'active',
  ...overrides,
});

export const buildFabricColorPayload = (overrides = {}) => ({
  name: `Fabric Color ${suffix()}`,
  colorCode: '#FFFFFF',
  pantone: '',
  status: 'active',
  ...overrides,
});

export const buildFabricQualityPayload = (overrides = {}) => ({
  name: `Fabric Quality ${suffix()}`,
  composition: '100% Cotton',
  status: 'active',
  ...overrides,
});

export const buildFabricYarnPayload = (overrides = {}) => ({
  name: `Yarn ${suffix()}`,
  status: 'active',
  ...overrides,
});

export const buildFabricCountPayload = (overrides = {}) => ({
  name: `Count ${suffix()}`,
  status: 'active',
  ...overrides,
});

export const buildFabricYarnCountPayload = (overrides = {}) => ({
  name: `Yarn Count ${suffix()}`,
  status: 'active',
  ...overrides,
});

export const buildFabricMeasurementPayload = (overrides = {}) => ({
  name: `Measurement ${suffix()}`,
  symbol: 'u',
  category: 'weight',
  status: 'active',
  ...overrides,
});

export const buildFabricCatalogPayload = (lookupIds = {}, overrides = {}) => ({
  name: `Fabric Catalog ${suffix()}`,
  fabricSortNo: `FC-${suffix()}`,
  millOldFabricSortNo: '17223',
  millNewFabricSortNo: 'AW0017223AB0586',
  fabricType: lookupIds.fabricTypeId || null,
  color: lookupIds.colorId || null,
  quality: lookupIds.qualityId || null,
  yarn: lookupIds.yarnId || null,
  count: lookupIds.countId || null,
  construction: '92x80',
  weave: 'Plain',
  design: 'Plain',
  wash: 'Yes',
  finish: 'NA',
  glm: 60,
  glmMeasurement: lookupIds.glmMeasurementId || null,
  finishedWidth: 44,
  finishedWidthMeasurement: lookupIds.finishedWidthMeasurementId || null,
  rate: 85,
  gst: '5',
  hsnCode: '52082100',
  minQuantity: 50,
  status: 'active',
  remark: 'Test fabric catalog',
  ...overrides,
});
