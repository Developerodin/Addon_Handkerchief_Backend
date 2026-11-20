/**
 * Replace on Atlas (target) only:
 *   - machines
 *   - productionracks
 *   - Production module checkpoints (checkpointitems + checkpointlogs for that module;
 *     checkpointmodules row "Production" is upserted; other checkpoint modules untouched)
 *
 * Source: MONGODB_URL (local / EC2 production). Target: MONGODB_ATLAS_URL.
 *
 *   node scripts/sync-floor-masters-to-atlas.js --confirm
 *   node scripts/sync-floor-masters-to-atlas.js --dry-run
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const PRODUCTION_MODULE = 'Production';

const wantsConfirm = () => process.argv.includes('--confirm');
const wantsDryRun = () => process.argv.includes('--dry-run');

const sourceUrl = () => {
  const fromArg = process.argv.find((a) => a.startsWith('mongodb') && a !== process.env.MONGODB_ATLAS_URL);
  if (fromArg && process.argv.indexOf(fromArg) === 2) return fromArg;
  if (process.env.MONGODB_URL) return process.env.MONGODB_URL;
  throw new Error('Set MONGODB_URL in .env (source).');
};

const targetUrl = () => {
  const args = process.argv.filter((a) => a.includes('mongodb'));
  if (args.length >= 2) return args[1];
  if (process.env.MONGODB_ATLAS_URL) return process.env.MONGODB_ATLAS_URL;
  throw new Error('Set MONGODB_ATLAS_URL in .env (target).');
};

const safeUrl = (url) => url.replace(/\/\/([^:]+):([^@]+)@/, '//$1:***@');

const connect = async (url, label) => {
  const conn = mongoose.createConnection(url, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });
  await new Promise((resolve, reject) => {
    conn.once('open', resolve);
    conn.once('error', reject);
  });
  console.log(`${label}: ${safeUrl(url)}`);
  return conn;
};

/**
 * @param {import('mongoose').Connection} source
 * @param {import('mongoose').Connection} target
 * @param {string} collection
 */
const replaceCollection = async (source, target, collection) => {
  const docs = await source.db.collection(collection).find({}).toArray();
  const targetColl = target.db.collection(collection);
  const before = await targetColl.countDocuments();
  if (!wantsDryRun()) {
    await targetColl.deleteMany({});
    if (docs.length > 0) {
      await targetColl.insertMany(docs, { ordered: false });
    }
  }
  return { collection, sourceCount: docs.length, targetBefore: before };
};

/**
 * @param {import('mongoose').Connection} source
 * @param {import('mongoose').Connection} target
 */
const replaceProductionCheckpoints = async (source, target) => {
  const srcModules = source.db.collection('checkpointmodules');
  const srcItems = source.db.collection('checkpointitems');
  const srcLogs = source.db.collection('checkpointlogs');

  const tgtModules = target.db.collection('checkpointmodules');
  const tgtItems = target.db.collection('checkpointitems');
  const tgtLogs = target.db.collection('checkpointlogs');

  const sourceModule = await srcModules.findOne({ name: PRODUCTION_MODULE });
  if (!sourceModule) {
    throw new Error(`Source has no checkpoint module "${PRODUCTION_MODULE}". Run seed:production-checkpoints locally.`);
  }

  const sourceItemDocs = await srcItems.find({ moduleId: sourceModule._id }).sort({ sortOrder: 1 }).toArray();

  let targetModule = await tgtModules.findOne({ name: PRODUCTION_MODULE });
  const targetItemIds = targetModule
    ? (await tgtItems.find({ moduleId: targetModule._id }, { projection: { _id: 1 } }).toArray()).map((d) => d._id)
    : [];

  const targetBefore = targetItemIds.length;
  const logBefore = targetModule
    ? await tgtLogs.countDocuments({
        $or: [{ moduleId: targetModule._id }, { itemId: { $in: targetItemIds } }],
      })
    : 0;

  if (wantsDryRun()) {
    return {
      collection: 'checkpoints (Production only)',
      sourceCount: sourceItemDocs.length,
      targetBefore,
      logsTargetBefore: logBefore,
    };
  }

  if (!targetModule) {
    const { _id, ...rest } = sourceModule;
    const insertResult = await tgtModules.insertOne({ ...rest, name: PRODUCTION_MODULE });
    targetModule = await tgtModules.findOne({ _id: insertResult.insertedId });
  } else {
    await tgtModules.updateOne(
      { _id: targetModule._id },
      {
        $set: {
          sortOrder: sourceModule.sortOrder,
        },
      }
    );
  }

  if (targetItemIds.length > 0) {
    await tgtLogs.deleteMany({
      $or: [{ moduleId: targetModule._id }, { itemId: { $in: targetItemIds } }],
    });
    await tgtItems.deleteMany({ moduleId: targetModule._id });
  }

  if (sourceItemDocs.length > 0) {
    const toInsert = sourceItemDocs.map(({ _id, moduleId, ...rest }) => ({
      ...rest,
      moduleId: targetModule._id,
    }));
    await tgtItems.insertMany(toInsert, { ordered: true });
  }

  return {
    collection: 'checkpoints (Production only)',
    sourceCount: sourceItemDocs.length,
    targetBefore,
    logsRemoved: logBefore,
  };
};

const main = async () => {
  if (!wantsConfirm() && !wantsDryRun()) {
    console.error('Pass --confirm to write to Atlas, or --dry-run to preview counts.');
    process.exit(2);
  }

  const source = await connect(sourceUrl(), 'Source');
  const target = await connect(targetUrl(), 'Target');

  const machineResult = await replaceCollection(source, target, 'machines');
  const rackResult = await replaceCollection(source, target, 'productionracks');
  const cpResult = await replaceProductionCheckpoints(source, target);

  console.log('');
  console.log(wantsDryRun() ? 'Dry run (no writes):' : 'Replaced on Atlas:');
  console.log(`  machines: ${machineResult.sourceCount} docs (was ${machineResult.targetBefore} on Atlas)`);
  console.log(`  productionracks: ${rackResult.sourceCount} docs (was ${rackResult.targetBefore} on Atlas)`);
  console.log(
    `  ${cpResult.collection}: ${cpResult.sourceCount} items (was ${cpResult.targetBefore} on Atlas` +
      (cpResult.logsRemoved != null ? `, removed ${cpResult.logsRemoved} logs` : '') +
      ')'
  );

  await source.close();
  await target.close();
};

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});