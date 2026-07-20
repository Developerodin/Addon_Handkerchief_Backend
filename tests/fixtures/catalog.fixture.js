import faker from 'faker';

const suffix = () => `${Date.now()}-${faker.random.alphaNumeric(6)}`;

export const buildCategoryPayload = (overrides = {}) => ({
  name: `Category ${suffix()}`,
  description: 'Test category',
  status: 'active',
  ...overrides,
});

export const buildAttributePayload = (overrides = {}) => ({
  name: `Attribute ${suffix()}`,
  attributeType: 'Manufacturing',
  type: 'select',
  sortOrder: 0,
  optionValues: [{ name: 'Option A', sortOrder: 0 }],
  ...overrides,
});

export const buildRawMaterialPayload = (overrides = {}) => ({
  name: `Raw Material ${suffix()}`,
  groupName: 'Test Group',
  type: 'Yarn',
  description: 'Test raw material',
  brand: 'Test Brand',
  countSize: '30s',
  material: 'Cotton',
  color: 'White',
  shade: 'Natural',
  unit: 'Kg',
  mrp: '100',
  hsnCode: '5201',
  gst: '5',
  articleNo: `ART-${suffix()}`,
  ...overrides,
});

export const buildProcessPayload = (overrides = {}) => ({
  name: `Process ${suffix()}`,
  type: 'Knitting',
  description: 'Test process',
  status: 'active',
  steps: [
    {
      stepTitle: 'Step 1',
      stepDescription: 'First step',
      duration: 10,
    },
  ],
  ...overrides,
});

export const buildStyleCodePayload = (overrides = {}) => ({
  styleCode: `SC-${suffix()}`,
  eanCode: faker.random.alphaNumeric(13),
  mrp: 499,
  brand: 'Test Brand',
  pack: 'Single',
  status: 'active',
  ...overrides,
});

export const buildProductPayload = ({ categoryId, styleCodeId, processId, rawMaterialId, overrides = {} }) => ({
  name: `Product ${suffix()}`,
  softwareCode: `SW-${suffix()}`,
  productionType: 'internal',
  description: 'Test product',
  category: categoryId,
  styleCodes: styleCodeId ? [styleCodeId] : [],
  processes: processId ? [{ processId }] : [],
  rawMaterials: rawMaterialId ? [{ rawMaterialId, quantity: 1 }] : [],
  status: 'active',
  attributes: {},
  ...overrides,
});
