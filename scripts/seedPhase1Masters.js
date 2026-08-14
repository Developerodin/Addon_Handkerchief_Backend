/**
 * Seed Phase 1 master data for handkerchief catalog.
 * Usage: node scripts/seedPhase1Masters.js
 */
import mongoose from 'mongoose';
import config from '../src/config/config.js';
import Category from '../src/models/category.model.js';
import ProductAttribute from '../src/models/productAttribute.model.js';
import Process from '../src/models/process.model.js';

const SAMPLE_TAG = '[HK Phase1]';

const ATTRIBUTES = [
  { name: 'Size', attributeType: 'Manufacturing', type: 'select', optionValues: [{ name: '12x12' }, { name: '16x16' }, { name: '18x18' }] },
  { name: 'GSM', attributeType: 'Manufacturing', type: 'number', optionValues: [] },
  { name: 'Fabric Type', attributeType: 'Manufacturing', type: 'select', optionValues: [{ name: 'Cotton' }, { name: 'Blend' }, { name: 'Linen' }] },
  { name: 'Colour', attributeType: 'Manufacturing', type: 'select', optionValues: [{ name: 'White' }, { name: 'Ivory' }, { name: 'Assorted' }] },
  { name: 'Pattern', attributeType: 'Manufacturing', type: 'select', optionValues: [{ name: 'Plain' }, { name: 'Print' }, { name: 'Check' }] },
  { name: 'Border Type', attributeType: 'Manufacturing', type: 'select', optionValues: [{ name: 'Plain' }, { name: 'Lace' }, { name: 'Embroidery' }] },
  { name: 'Hemming Type', attributeType: 'Manufacturing', type: 'select', optionValues: [{ name: 'Vertical' }, { name: 'Horizontal' }] },
  { name: 'Embroidery', attributeType: 'Manufacturing', type: 'select', optionValues: [{ name: 'Yes' }, { name: 'No' }] },
  { name: 'Gender', attributeType: 'Warehouse', type: 'select', optionValues: [{ name: 'Unisex' }, { name: 'Men' }, { name: 'Women' }] },
  { name: 'Occasion', attributeType: 'Warehouse', type: 'select', optionValues: [{ name: 'Daily' }, { name: 'Gift' }, { name: 'Wedding' }] },
  { name: 'Season', attributeType: 'Warehouse', type: 'select', optionValues: [{ name: 'SS' }, { name: 'AW' }, { name: 'All' }] },
  { name: 'Pack Size', attributeType: 'Warehouse', type: 'select', optionValues: [{ name: '1' }, { name: '3' }, { name: '6' }, { name: '12' }] },
];

const PROCESSES = [
  { name: 'Cutting', code: 'CUT', type: 'cutting', department: 'cutting', machineType: 'cutting', qcCheckpoint: false, reworkEligible: true, sortOrder: 1 },
  { name: 'Selvage', code: 'SEL', type: 'cutting', department: 'cutting', machineType: 'cutting', sortOrder: 2 },
  { name: 'Half-moon', code: 'HM', type: 'cutting', department: 'cutting', machineType: 'half-moon', sortOrder: 3 },
  { name: 'Vertical Hemming', code: 'VH', type: 'hemming', department: 'hemming', machineType: 'vertical-hemming', sortOrder: 4 },
  { name: 'Horizontal Hemming', code: 'HH', type: 'hemming', department: 'hemming', machineType: 'horizontal-hemming', sortOrder: 5 },
  { name: 'Checking', code: 'CHK', type: 'checking', department: 'checking', machineType: 'none', qcCheckpoint: true, reworkEligible: true, sortOrder: 6 },
  { name: 'Ironing', code: 'IRN', type: 'ironing', department: 'ironing', machineType: 'ironing', sortOrder: 7 },
  { name: 'Packing', code: 'PKG', type: 'packing', department: 'packing', machineType: 'none', sortOrder: 8 },
  { name: 'Embroidery', code: 'EMB', type: 'embroidery', department: 'embroidery', machineType: 'embroidery', sortOrder: 9 },
];

async function main() {
  await mongoose.connect(config.mongoose.url, config.mongoose.options);
  console.log('Connected');

  await Category.deleteMany({ description: new RegExp(SAMPLE_TAG) });
  await ProductAttribute.deleteMany({ name: new RegExp(`^${SAMPLE_TAG}`) });
  await Process.deleteMany({ description: new RegExp(SAMPLE_TAG) });

  const root = await Category.create({
    name: 'Handkerchief',
    description: `Finished handkerchief products ${SAMPLE_TAG}`,
    sortOrder: 1,
    status: 'active',
  });

  const plain = await Category.create({
    name: 'Plain',
    parent: root._id,
    description: `Normal / plain handkerchief ${SAMPLE_TAG}`,
    sortOrder: 1,
    status: 'active',
  });

  const embroidery = await Category.create({
    name: 'Embroidery',
    parent: root._id,
    description: `Embroidery handkerchief ${SAMPLE_TAG}`,
    sortOrder: 2,
    status: 'active',
  });

  await Category.create({
    name: 'Floral',
    parent: embroidery._id,
    description: `Floral embroidery styles ${SAMPLE_TAG}`,
    sortOrder: 1,
    status: 'active',
  });

  console.log('Categories seeded:', { root: root.name, children: [plain.name, embroidery.name], grandchild: 'Floral' });

  let sort = 1;
  for (const attr of ATTRIBUTES) {
    await ProductAttribute.create({
      ...attr,
      name: `${SAMPLE_TAG} ${attr.name}`,
      sortOrder: sort++,
      required: ['Size', 'Colour', 'Fabric Type'].includes(attr.name),
      optionValues: (attr.optionValues || []).map((o, i) => ({ ...o, sortOrder: i + 1 })),
    });
  }

  for (const proc of PROCESSES) {
    await Process.create({
      ...proc,
      description: `${proc.name} process ${SAMPLE_TAG}`,
      floor: '1',
      standardTime: 10,
      standardRate: 0,
      qcCheckpoint: Boolean(proc.qcCheckpoint),
      reworkEligible: Boolean(proc.reworkEligible),
      status: 'active',
      steps: [
        {
          stepTitle: proc.name,
          stepDescription: `Execute ${proc.name}`,
          duration: 10,
        },
      ],
    });
  }

  console.log('Phase 1 seeds created');
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await mongoose.disconnect();
  } catch {
    // ignore
  }
  process.exit(1);
});
