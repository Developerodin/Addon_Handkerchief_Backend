import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Category from '../src/models/category.model.js';
import ProductAttribute from '../src/models/productAttribute.model.js';
import RawMaterial from '../src/models/rawMaterial.model.js';
import Process from '../src/models/process.model.js';
import StyleCode from '../src/models/styleCode.model.js';
import Product from '../src/models/product.model.js';

dotenv.config();

const SAMPLE_TAG = 'HK-SAMPLE';

const seedCatalogSample = async () => {
  const url = process.env.MONGODB_URL;
  if (!url) {
    console.error('MONGODB_URL is required');
    process.exit(1);
  }

  await mongoose.connect(url, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });

  const existing = await Category.findOne({ description: SAMPLE_TAG });
  if (existing && process.env.FORCE_CATALOG_SEED !== 'true') {
    console.log('Sample catalog data already exists. Set FORCE_CATALOG_SEED=true to re-seed.');
    await mongoose.disconnect();
    return;
  }

  if (existing) {
    await Product.deleteMany({ description: SAMPLE_TAG });
    await StyleCode.deleteMany({ brand: SAMPLE_TAG });
    await Process.deleteMany({ description: SAMPLE_TAG });
    await RawMaterial.deleteMany({ description: SAMPLE_TAG });
    await ProductAttribute.deleteMany({ name: new RegExp(`^${SAMPLE_TAG}`) });
    await Category.deleteMany({ description: SAMPLE_TAG });
  }

  const categories = await Category.insertMany([
    { name: 'Handkerchiefs', description: SAMPLE_TAG, sortOrder: 1, status: 'active' },
    { name: 'Premium Cotton', description: SAMPLE_TAG, sortOrder: 2, status: 'active' },
    { name: 'Gift Sets', description: SAMPLE_TAG, sortOrder: 3, status: 'active' },
  ]);

  const attributes = await ProductAttribute.insertMany([
    {
      name: `${SAMPLE_TAG} Color`,
      type: 'select',
      attributeType: 'Manufacturing',
      sortOrder: 1,
      optionValues: [
        { name: 'White', sortOrder: 1 },
        { name: 'Blue', sortOrder: 2 },
        { name: 'Red', sortOrder: 3 },
      ],
    },
    {
      name: `${SAMPLE_TAG} Pattern`,
      type: 'select',
      attributeType: 'Manufacturing',
      sortOrder: 2,
      optionValues: [
        { name: 'Plain', sortOrder: 1 },
        { name: 'Checked', sortOrder: 2 },
        { name: 'Embroidered', sortOrder: 3 },
      ],
    },
  ]);

  const rawMaterials = await RawMaterial.insertMany([
    {
      name: 'Cotton Yarn 30s',
      groupName: 'Yarn',
      type: 'Yarn',
      description: SAMPLE_TAG,
      brand: 'Addon',
      countSize: '30s',
      material: 'Cotton',
      color: 'White',
      shade: 'Natural',
      unit: 'Kg',
      mrp: '120',
      hsnCode: '5201',
      gst: '5',
      articleNo: 'HK-RM-001',
    },
    {
      name: 'Embroidery Thread',
      groupName: 'Thread',
      type: 'Thread',
      description: SAMPLE_TAG,
      brand: 'Addon',
      countSize: '40s',
      material: 'Polyester',
      color: 'Multi',
      shade: 'Assorted',
      unit: 'Kg',
      mrp: '85',
      hsnCode: '5401',
      gst: '5',
      articleNo: 'HK-RM-002',
    },
  ]);

  const processes = await Process.insertMany([
    {
      name: 'Cutting',
      type: 'Cutting',
      description: SAMPLE_TAG,
      status: 'active',
      steps: [{ stepTitle: 'Fabric cut', stepDescription: 'Cut to handkerchief size', duration: 5 }],
    },
    {
      name: 'Embroidery',
      type: 'Embroidery',
      description: SAMPLE_TAG,
      status: 'active',
      steps: [{ stepTitle: 'Logo embroidery', stepDescription: 'Apply brand logo', duration: 15 }],
    },
    {
      name: 'Packing',
      type: 'Packing',
      description: SAMPLE_TAG,
      status: 'active',
      steps: [{ stepTitle: 'Poly pack', stepDescription: 'Pack for dispatch', duration: 3 }],
    },
  ]);

  const styleCodes = await StyleCode.insertMany([
    {
      styleCode: 'HK-SC-001',
      eanCode: '8901234567890',
      mrp: 199,
      brand: SAMPLE_TAG,
      pack: 'Single',
      status: 'active',
    },
    {
      styleCode: 'HK-SC-002',
      eanCode: '8901234567891',
      mrp: 349,
      brand: SAMPLE_TAG,
      pack: 'Gift Pack',
      status: 'active',
    },
  ]);

  await Product.insertMany([
    {
      name: 'Classic White Handkerchief',
      softwareCode: 'HK-ITEM-001',
      internalCode: 'INT-HK-001',
      vendorCode: 'VND-001',
      factoryCode: 'FAC-001',
      productionType: 'internal',
      description: SAMPLE_TAG,
      category: categories[0]._id,
      status: 'active',
      styleCodes: [styleCodes[0]._id],
      processes: [{ processId: processes[0]._id }, { processId: processes[2]._id }],
      rawMaterials: [{ rawMaterialId: rawMaterials[0]._id, quantity: 0.05 }],
      attributes: {
        [`${SAMPLE_TAG} Color`]: 'White',
        [`${SAMPLE_TAG} Pattern`]: 'Plain',
      },
    },
    {
      name: 'Embroidered Gift Set',
      softwareCode: 'HK-ITEM-002',
      internalCode: 'INT-HK-002',
      vendorCode: 'VND-002',
      factoryCode: 'FAC-002',
      productionType: 'internal',
      description: SAMPLE_TAG,
      category: categories[2]._id,
      status: 'active',
      styleCodes: [styleCodes[1]._id],
      processes: [{ processId: processes[1]._id }, { processId: processes[2]._id }],
      rawMaterials: [
        { rawMaterialId: rawMaterials[0]._id, quantity: 0.08 },
        { rawMaterialId: rawMaterials[1]._id, quantity: 0.02 },
      ],
      attributes: {
        [`${SAMPLE_TAG} Color`]: 'Blue',
        [`${SAMPLE_TAG} Pattern`]: 'Embroidered',
      },
    },
  ]);

  console.log('Sample catalog seeded:');
  console.log(`  Categories: ${categories.length}`);
  console.log(`  Attributes: ${attributes.length}`);
  console.log(`  Raw Materials: ${rawMaterials.length}`);
  console.log(`  Processes: ${processes.length}`);
  console.log(`  Style Codes: ${styleCodes.length}`);
  console.log('  Items: 2');
  console.log(`Tag in DB: description="${SAMPLE_TAG}" or brand="${SAMPLE_TAG}"`);

  await mongoose.disconnect();
};

seedCatalogSample().catch((err) => {
  console.error(err);
  process.exit(1);
});
