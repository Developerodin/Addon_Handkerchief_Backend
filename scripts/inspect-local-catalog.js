import mongoose from 'mongoose';

const local = process.env.LOCAL_MONGODB_URL || 'mongodb://127.0.0.1:27017/handkerchief';
await mongoose.connect(local);
const db = mongoose.connection.db;
for (const c of ['processes', 'products', 'fabriccatalogs', 'categories', 'rawmaterials']) {
  console.log(c, await db.collection(c).countDocuments());
}
const prods = await db.collection('products').find({}).project({ name: 1, factoryCode: 1, productionType: 1 }).limit(15).toArray();
console.log('products:', prods);
await mongoose.disconnect();