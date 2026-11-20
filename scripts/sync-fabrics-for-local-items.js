/**
 * Upsert fabrics referenced by local products into Atlas.
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import config from '../src/config/config.js';
import FabricCatalog from '../src/models/fabricCatalog.model.js';

dotenv.config();

const localUrl = process.env.LOCAL_MONGODB_URL || 'mongodb://127.0.0.1:27017/handkerchief';
const atlasUrl = process.env.MONGODB_URL || config.mongoose.url;

await mongoose.connect(localUrl);
const products = await mongoose.connection.db.collection('products').find({}).toArray();
const fabricIds = new Set();
for (const p of products) {
  for (const line of p.bom || []) {
    if (line.fabricCatalogId) fabricIds.add(String(line.fabricCatalogId));
  }
}
const locals = await mongoose.connection.db
  .collection('fabriccatalogs')
  .find({ _id: { $in: [...fabricIds].map((id) => new mongoose.Types.ObjectId(id)) } })
  .toArray();
await mongoose.disconnect();

await mongoose.connect(atlasUrl, config.mongoose.options || {});
let upserted = 0;
for (const row of locals) {
  const sortNo = String(row.fabricSortNo || row.sortNo || '').trim();
  const { _id, __v, ...rest } = row;
  const filter = sortNo ? { fabricSortNo: sortNo } : { name: row.name };
  const existing = await FabricCatalog.findOne(filter);
  if (existing) {
    Object.assign(existing, rest, { fabricSortNo: sortNo || existing.fabricSortNo });
    await existing.save();
  } else {
    await FabricCatalog.create({ ...rest, fabricSortNo: sortNo });
  }
  upserted += 1;
  console.log(`Fabric ${sortNo || row.name}`);
}
console.log(`Upserted ${upserted} fabric(s) on Atlas`);
await mongoose.disconnect();