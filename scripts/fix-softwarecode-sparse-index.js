/**
 * Recreate products.softwareCode as a sparse unique index.
 * The live index was unique but not sparse, so a second product without
 * softwareCode failed with E11000 → HTTP 500 on item create/save.
 */
import mongoose from 'mongoose';
import cfg from '../src/config/config.js';

await mongoose.connect(cfg.mongoose.url, cfg.mongoose.options);
const collection = mongoose.connection.db.collection('products');

try {
  await collection.dropIndex('softwareCode_1');
  console.log('Dropped softwareCode_1');
} catch (error) {
  console.log('dropIndex:', error.message);
}

await collection.createIndex({ softwareCode: 1 }, { unique: true, sparse: true, background: true });
console.log('Created sparse unique softwareCode_1');
console.log(JSON.stringify(await collection.indexes(), null, 2));
await mongoose.disconnect();
