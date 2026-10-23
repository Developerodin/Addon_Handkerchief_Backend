/**
 * Upsert Manufacturing SELECT "Stitch type" (Hem 1–4) into attributes master.
 * Usage: node scripts/seedStitchTypeAttribute.js
 */
import mongoose from 'mongoose';
import config from '../src/config/config.js';
import ProductAttribute from '../src/models/productAttribute.model.js';

const ATTRIBUTE_NAME = 'Stitch type';
const OPTION_VALUES = [
  { name: 'Hem 1', sortOrder: 1 },
  { name: 'Hem 2', sortOrder: 2 },
  { name: 'Hem 3', sortOrder: 3 },
  { name: 'Hem 4', sortOrder: 4 },
];

async function main() {
  await mongoose.connect(config.mongoose.url, config.mongoose.options);
  console.log('Connected');

  const existing = await ProductAttribute.findOne({
    name: new RegExp(`^${ATTRIBUTE_NAME}$`, 'i'),
  });

  if (existing) {
    existing.attributeType = 'Manufacturing';
    existing.type = 'select';
    existing.required = false;
    existing.optionValues = OPTION_VALUES;
    await existing.save();
    console.log(`Updated existing attribute "${existing.name}" id=${existing.id}`);
  } else {
    const created = await ProductAttribute.create({
      name: ATTRIBUTE_NAME,
      attributeType: 'Manufacturing',
      type: 'select',
      required: false,
      sortOrder: 0,
      optionValues: OPTION_VALUES,
    });
    console.log(`Created attribute "${created.name}" id=${created.id}`);
  }

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
