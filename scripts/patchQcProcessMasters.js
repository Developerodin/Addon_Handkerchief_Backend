/**
 * Adds QC process masters and refreshes demo item routes (no product wipe).
 *
 *   npm run patch:qc-processes
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Process from '../src/models/process.model.js';
import Product from '../src/models/product.model.js';
import { publishItemDefinition } from '../src/services/catalogPublish.service.js';

dotenv.config();

const TAG = 'HK-PROD-DEMO';

const QC_PROCESSES = [
  { name: 'Floor checks', code: 'FLC', type: 'checking', department: 'checking', machineType: 'none', floor: 'floor-check', qcCheckpoint: true, sortOrder: 55 },
  { name: 'Final QC', code: 'FQC', type: 'checking', department: 'checking', machineType: 'none', floor: 'final-qc', qcCheckpoint: true, sortOrder: 75 },
  { name: 'Final checking', code: 'FCH', type: 'checking', department: 'checking', machineType: 'none', floor: 'final-checking', qcCheckpoint: true, sortOrder: 130 },
];

const CORE_SEQUENCE = ['VTC', 'SEL', 'HM', 'VH', 'SPC', 'FLC', 'HH', 'ILC', 'THC', 'FQC', 'IRN'];

const sequenceFor = (productionType) => {
  if (productionType === 'embroidery') return [...CORE_SEQUENCE, 'EMB', 'EMT', 'IRA', 'FCH'];
  if (productionType === 'sticker') return [...CORE_SEQUENCE, 'STK', 'IRA', 'FCH'];
  return [...CORE_SEQUENCE, 'FCH'];
};

async function upsertQc() {
  for (const row of QC_PROCESSES) {
    const existing = await Process.findOne({ code: row.code });
    if (existing) {
      await Process.updateOne(
        { _id: existing._id },
        {
          $set: {
            ...row,
            description: `${row.name} (${TAG})`,
            standardTime: 10,
            standardRate: 0,
            reworkEligible: true,
            status: 'active',
            steps: [{ stepTitle: row.name, stepDescription: row.name, duration: 10 }],
          },
        }
      );
    } else {
      await Process.create({
        ...row,
        description: `${row.name} (${TAG})`,
        standardTime: 10,
        standardRate: 0,
        reworkEligible: true,
        status: 'active',
        steps: [{ stepTitle: row.name, stepDescription: row.name, duration: 10 }],
      });
    }
  }
}

async function main() {
  const url = process.env.MONGODB_URL;
  if (!url) throw new Error('MONGODB_URL is required');
  await mongoose.connect(url, { useNewUrlParser: true, useUnifiedTopology: true });

  await upsertQc();

  const byCode = new Map(
    (await Process.find({ status: 'active' }).select('code name')).map((row) => [row.code, row])
  );

  const products = await Product.find({ description: TAG });
  for (const product of products) {
    const codes = sequenceFor(product.productionType);
    product.processes = codes.map((code) => {
      const row = byCode.get(code);
      if (!row) throw new Error(`Process code missing: ${code}`);
      return { processId: row._id };
    });
    await product.save();
    await publishItemDefinition(product);
    console.log(`Updated ${product.factoryCode}: ${codes.length} steps`);
  }

  console.log('\nQC processes in catalog:', QC_PROCESSES.map((r) => r.name).join(', '));
  console.log(`Refreshed ${products.length} demo item(s).`);

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