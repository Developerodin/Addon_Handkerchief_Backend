/**
 * Drops every collection in the database named on MONGODB_ATLAS_URL (or argv URI).
 * Use before a full EC2 → Atlas sync when you want Atlas wiped first.
 *
 *   node scripts/empty-atlas-database.js --confirm
 *   node scripts/empty-atlas-database.js --confirm "mongodb+srv://…/test?…"
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const wantsConfirm = () => process.argv.includes('--confirm');

const mongoUrl = () => {
  const fromArg = process.argv.find((a) => a.includes('mongodb'));
  if (fromArg) return fromArg;
  if (process.env.MONGODB_ATLAS_URL) return process.env.MONGODB_ATLAS_URL;
  throw new Error('Set MONGODB_ATLAS_URL in .env or pass the Atlas URI as an argument.');
};

const dbNameFromUri = (uri) => {
  const base = uri.split('?')[0];
  const match = base.match(/^mongodb(\+srv)?:\/\/[^/]+\/([^/]+)$/);
  if (!match) throw new Error('URI must include a database name, e.g. …/test?retryWrites=true');
  return match[2];
};

const safeUrl = (url) => url.replace(/\/\/([^:]+):([^@]+)@/, '//$1:***@');

const main = async () => {
  if (!wantsConfirm()) {
    const url = mongoUrl();
    const dbName = dbNameFromUri(url);
    console.error(`Refusing to run without --confirm.`);
    console.error(`This will drop ALL collections in Atlas database "${dbName}".`);
    console.error(`Then run: node scripts/empty-atlas-database.js --confirm`);
    process.exit(2);
  }

  const url = mongoUrl();
  const dbName = dbNameFromUri(url);
  console.log(`Target: ${safeUrl(url)}`);
  console.log(`Database: ${dbName}`);

  await mongoose.connect(url, { useNewUrlParser: true, useUnifiedTopology: true });
  const conn = mongoose.connection;
  const collections = await conn.db.listCollections().toArray();
  const names = collections.map((c) => c.name).filter((n) => !n.startsWith('system.'));

  if (names.length === 0) {
    console.log('No collections to drop (database already empty).');
    await mongoose.disconnect();
    return;
  }

  console.log(`Dropping ${names.length} collections…`);
  for (const name of names) {
    await conn.db.dropCollection(name);
    console.log(`  - dropped ${name}`);
  }

  console.log('Atlas database is empty. Run sync-ec2-production-to-atlas.sh --confirm on production.');
  await mongoose.disconnect();
};

main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : err);
  try {
    await mongoose.disconnect();
  } catch (_) {
    /* ignore */
  }
  process.exit(1);
});