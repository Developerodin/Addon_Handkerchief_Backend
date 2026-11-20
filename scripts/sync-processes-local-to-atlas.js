/**
 * Copy Process master rows from local EC2 MongoDB into Atlas (MONGODB_URL).
 *
 *   LOCAL_MONGODB_URL=mongodb://127.0.0.1:27017/handkerchief \
 *   npx cross-env NODE_ENV=development node scripts/sync-processes-local-to-atlas.js
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Process from '../src/models/process.model.js';
import config from '../src/config/config.js';

dotenv.config();

const localUrl = process.env.LOCAL_MONGODB_URL || 'mongodb://127.0.0.1:27017/handkerchief';
const atlasUrl = process.env.MONGODB_URL || config.mongoose?.url;
if (!atlasUrl) throw new Error('Set MONGODB_URL for Atlas target');

function stripDoc(doc) {
  const { _id, __v, createdAt, updatedAt, id, ...rest } = doc;
  const steps = (rest.steps || []).map((step) => {
    const { _id: stepId, createdAt: _c, updatedAt: _u, ...s } = step;
    return s;
  });
  return { ...rest, steps };
}

async function loadFrom(conn, label) {
  const col = conn.db.collection('processes');
  const rows = await col.find({}).toArray();
  console.log(`${label}: ${rows.length} process(es)`);
  return rows;
}

function matchKey(row) {
  const code = String(row.code || '').trim();
  if (code) return `code:${code}`;
  return `name:${String(row.name || '').trim().toLowerCase()}`;
}

await mongoose.connect(localUrl, { useNewUrlParser: true, useUnifiedTopology: true });
const localConn = mongoose.connection;
const localRows = await loadFrom(localConn, 'Local');
await mongoose.disconnect();

if (!localRows.length) {
  console.error('No processes on local DB. Start EC2 Mongo or run seed on local first.');
  process.exit(1);
}

await mongoose.connect(atlasUrl, config.mongoose?.options || { useNewUrlParser: true, useUnifiedTopology: true });

let upserted = 0;
let created = 0;
for (const row of localRows) {
  const payload = stripDoc(row);
  const code = String(payload.code || '').trim();
  const filter = code ? { code } : { name: payload.name };
  const existing = await Process.findOne(filter);
  if (existing) {
    Object.assign(existing, payload);
    await existing.save();
    upserted += 1;
  } else {
    await Process.create(payload);
    created += 1;
  }
}

const atlasCount = await Process.countDocuments({ status: 'active' });
console.log(`Atlas: updated ${upserted}, created ${created}, active total ${atlasCount}`);

const byCode = new Map((await Process.find({ code: { $ne: '' } }).lean()).map((r) => [r.code, r.name]));
console.log('Sample codes:', [...byCode.entries()].slice(0, 8).map(([c, n]) => `${c}=${n}`).join(', '));

await mongoose.disconnect();