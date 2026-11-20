/**
 * Resets process master + catalog items for production floor testing.
 *
 *   FORCE_CATALOG_DEMO=true npm run seed:production-catalog-demo
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Category from '../src/models/category.model.js';
import FabricCatalog from '../src/models/fabricCatalog.model.js';
import Process from '../src/models/process.model.js';
import Product from '../src/models/product.model.js';
import RawMaterial from '../src/models/rawMaterial.model.js';
import { publishItemDefinition } from '../src/services/catalogPublish.service.js';
import Machine from '../src/models/machine.model.js';

dotenv.config();

const TAG = 'HK-PROD-DEMO';

const FLOOR_PROCESSES = [
  { name: 'Vertical cutting', code: 'VTC', type: 'cutting', department: 'cutting', machineType: 'cutting', floor: 'vertical-cut', sortOrder: 10 },
  { name: 'Selvage cutting', code: 'SEL', type: 'cutting', department: 'cutting', machineType: 'cutting', floor: 'selvage', sortOrder: 20 },
  { name: 'Half moon cutting', code: 'HM', type: 'cutting', department: 'cutting', machineType: 'half-moon', floor: 'half-moon', sortOrder: 30 },
  { name: 'Vertical hemming', code: 'VH', type: 'hemming', department: 'hemming', machineType: 'vertical-hemming', floor: 'vertical-hem', sortOrder: 40 },
  { name: 'Single piece cutting', code: 'SPC', type: 'cutting', department: 'cutting', machineType: 'cutting', floor: 'single-piece-cutting', sortOrder: 50 },
  { name: 'Floor checks', code: 'FLC', type: 'checking', department: 'checking', machineType: 'none', floor: 'floor-check', qcCheckpoint: true, sortOrder: 55 },
  { name: 'Horizontal hemming', code: 'HH', type: 'hemming', department: 'hemming', machineType: 'horizontal-hemming', floor: 'horizontal-hem', sortOrder: 60 },
  {
    name: 'Inline checking',
    code: 'ILC',
    type: 'checking',
    department: 'checking',
    machineType: 'none',
    floor: 'inline-check',
    sortOrder: 65,
  },
  { name: 'Thread cutting', code: 'THC', type: 'hemming', department: 'hemming', machineType: 'none', floor: 'thread-cutting', threadConsuming: true, sortOrder: 70 },
  { name: 'Final QC', code: 'FQC', type: 'checking', department: 'checking', machineType: 'none', floor: 'final-qc', qcCheckpoint: true, sortOrder: 75 },
  { name: 'Ironing', code: 'IRN', type: 'ironing', department: 'ironing', machineType: 'ironing', floor: 'iron', sortOrder: 80 },
  { name: 'Embroidery', code: 'EMB', type: 'embroidery', department: 'embroidery', machineType: 'embroidery', floor: 'embroidery', sortOrder: 90 },
  { name: 'Thread cutting after embroidery', code: 'EMT', type: 'hemming', department: 'embroidery', machineType: 'none', floor: 'embroidery-thread-cut', threadConsuming: true, sortOrder: 100 },
  { name: 'Sticker', code: 'STK', type: 'packing', department: 'packing', machineType: 'none', floor: 'sticker', sortOrder: 110 },
  { name: 'Ironing after route', code: 'IRA', type: 'ironing', department: 'ironing', machineType: 'ironing', floor: 'iron-after', sortOrder: 120 },
  { name: 'Final checking', code: 'FCH', type: 'checking', department: 'checking', machineType: 'none', floor: 'final-checking', qcCheckpoint: true, sortOrder: 130 },
];

/** Shared cutting/hemming/QC/iron steps (matches Production sidebar). */
const CORE_SEQUENCE = ['VTC', 'SEL', 'HM', 'VH', 'SPC', 'FLC', 'HH', 'ILC', 'THC', 'FQC', 'IRN'];
const sequenceFor = (productionType) => {
  if (productionType === 'embroidery') return [...CORE_SEQUENCE, 'EMB', 'EMT', 'IRA', 'FCH'];
  if (productionType === 'sticker') return [...CORE_SEQUENCE, 'STK', 'IRA', 'FCH'];
  return [...CORE_SEQUENCE, 'FCH'];
};

const DEMO_ITEMS = [
  {
    name: 'Demo Plain Hanky White',
    articleName: 'Plain 47x47 White',
    factoryCode: 'HK-D-NORM-01',
    softwareCode: 'HK-D-NORM-01',
    productionType: 'normal',
    piecesPerCut: 3,
    fabricSortNo: 'H0001W',
    metresPerPiece: 0.12,
    sizeLabel: '47*47',
    processCodes: sequenceFor('normal'),
  },
  {
    name: 'Demo Plain Hanky Ivory 4-cut',
    articleName: 'Plain 47x47 Ivory',
    factoryCode: 'HK-D-NORM-02',
    softwareCode: 'HK-D-NORM-02',
    productionType: 'normal',
    piecesPerCut: 4,
    fabricSortNo: 'H0020I',
    metresPerPiece: 0.11,
    sizeLabel: '47*47',
    processCodes: sequenceFor('normal'),
  },
  {
    name: 'Demo Embroidery Logo Hanky',
    articleName: 'Embroidery Navy',
    factoryCode: 'HK-D-EMB-01',
    softwareCode: 'HK-D-EMB-01',
    productionType: 'embroidery',
    piecesPerCut: 3,
    fabricSortNo: 'H0010B',
    metresPerPiece: 0.13,
    sizeLabel: '47*47',
    processCodes: sequenceFor('embroidery'),
  },
  {
    name: 'Demo Embroidery Floral',
    articleName: 'Floral embroidery Cambric',
    factoryCode: 'HK-D-EMB-02',
    softwareCode: 'HK-D-EMB-02',
    productionType: 'embroidery',
    piecesPerCut: 3,
    fabricSortNo: '231',
    metresPerPiece: 0.1,
    sizeLabel: '40*40',
    processCodes: sequenceFor('embroidery'),
  },
  {
    name: 'Demo Sticker Brand Hanky',
    articleName: 'Sticker route White',
    factoryCode: 'HK-D-STK-01',
    softwareCode: 'HK-D-STK-01',
    productionType: 'sticker',
    piecesPerCut: 3,
    fabricSortNo: 'H0001W',
    metresPerPiece: 0.12,
    sizeLabel: '47*47',
    processCodes: sequenceFor('sticker'),
  },
];

/**
 * @param {string[]} codes
 * @param {Map<string, import('mongoose').Document>} byCode
 */
function processIds(codes, byCode) {
  return codes.map((code) => {
    const row = byCode.get(code);
    if (!row) throw new Error(`Missing process code ${code}`);
    return { processId: row._id };
  });
}

async function ensureCategory() {
  let category = await Category.findOne({ description: TAG });
  if (!category) {
    category = await Category.create({
      name: 'Handkerchief demo',
      description: TAG,
      status: 'active',
      sortOrder: 1,
    });
  }
  return category;
}

/**
 * @param {string} sortNo
 */
async function fabricBySort(sortNo) {
  const fabric =
    (await FabricCatalog.findOne({ fabricSortNo: sortNo })) ||
    (await FabricCatalog.findOne({ name: new RegExp(sortNo, 'i') }));
  if (!fabric) throw new Error(`Fabric not found for sortNo=${sortNo}`);
  return fabric;
}

async function main() {
  if (process.env.FORCE_CATALOG_DEMO !== 'true') {
    console.error('Set FORCE_CATALOG_DEMO=true to clear products/processes and re-seed.');
    process.exit(1);
  }
  const url = process.env.MONGODB_URL;
  if (!url) throw new Error('MONGODB_URL is required');

  await mongoose.connect(url, { useNewUrlParser: true, useUnifiedTopology: true });

  await Product.deleteMany({});
  await Process.deleteMany({ description: TAG });
  await Process.deleteMany({ name: /^P-\d+$/ });
  await Process.deleteMany({ code: '' });

  const category = await ensureCategory();
  const sewingThread =
    (await RawMaterial.findOne({ type: /thread/i })) ||
    (await RawMaterial.create({
      name: 'Demo sewing thread',
      type: 'thread',
      groupName: 'Thread',
      description: TAG,
      unit: 'Kg',
      status: 'active',
    }));

  const processDocs = [];
  for (const row of FLOOR_PROCESSES) {
    const doc = await Process.create({
      ...row,
      description: `${row.name} (${TAG})`,
      floor: row.floor,
      standardTime: 10,
      standardRate: 0,
      qcCheckpoint: row.floor === 'thread-cutting',
      reworkEligible: true,
      status: 'active',
      steps: [{ stepTitle: row.name, stepDescription: row.name, duration: 10 }],
    });
    processDocs.push(doc);
  }
  const byCode = new Map(processDocs.map((doc) => [doc.code, doc]));

  const created = [];
  for (const spec of DEMO_ITEMS) {
    const fabric = await fabricBySort(spec.fabricSortNo);
    const bomLineId = `bom-${spec.factoryCode}`;
    const product = await Product.create({
      name: spec.name,
      articleName: spec.articleName,
      factoryCode: spec.factoryCode,
      softwareCode: spec.softwareCode,
      vendorCode: 'VND-DEMO',
      vendorName: 'Addon Demo Vendor',
      productionType: spec.productionType,
      piecesPerCut: spec.piecesPerCut,
      description: TAG,
      category: category._id,
      status: 'active',
      hsnCode: '6213',
      gst: '5',
      bom: [
        {
          bomLineId,
          fabricCatalogId: fabric._id,
          fabricName: fabric.name,
          quantity: spec.metresPerPiece,
          piecesPerMeter: spec.metresPerPiece > 0 ? Math.round((1 / spec.metresPerPiece) * 1000) / 1000 : 0,
          sizeLabel: spec.sizeLabel,
          uom: 'CM',
          unitCost: Number(fabric.rate) || 0,
        },
      ],
      rawMaterials: [
        {
          bomLineId: `thread-${spec.factoryCode}`,
          rawMaterialId: sewingThread._id,
          quantity: 0.002,
          materialRole: 'sewing-thread',
        },
        ...(spec.productionType === 'embroidery'
          ? [
              {
                bomLineId: `emb-thread-${spec.factoryCode}`,
                rawMaterialId: sewingThread._id,
                quantity: 0.001,
                materialRole: 'embroidery-thread',
              },
            ]
          : []),
      ],
      processes: processIds(spec.processCodes, byCode),
    });
    await publishItemDefinition(product);
    created.push(product);
  }

  console.log('\n--- Production catalog demo seeded ---');
  console.log(`Processes: ${processDocs.length} (tag ${TAG})`);
  console.log(`Items: ${created.length}`);
  created.forEach((row) => {
    console.log(`  ${row.factoryCode} · ${row.productionType} · ${row.name}`);
  });
  console.log('\nOpen: http://localhost:3000/catalog/items/');
  console.log('Processes: http://localhost:3000/catalog/processes/');

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