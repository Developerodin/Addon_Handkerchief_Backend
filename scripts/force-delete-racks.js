/**
 * Force-deletes every storage rack in the database this process is pointed at.
 * Roll movements stay. The connection string is never printed.
 *
 * Development:
 *   NODE_ENV=development node --disable-warning=DEP0170 scripts/force-delete-racks.js --yes
 * Production, on the server whose .env is the production database:
 *   NODE_ENV=production node --disable-warning=DEP0170 scripts/force-delete-racks.js --yes --production
 */
import mongoose from 'mongoose';
import cfg from '../src/config/config.js';
import StorageRack from '../src/models/storageRack.model.js';
import { StockMovement } from '../src/models/store.model.js';

const OFF_RACK = new Set(['', 'floor', 'vendor', 'dispatched']);

/**
 * Stops Node from printing the MongoDB URL when the connection string has a username.
 */
function silenceMongoUrlWarning() {
  const { emitWarning } = process;
  process.emitWarning = (warning, ...args) => {
    if (args[0] === 'DeprecationWarning' && args[1] === 'DEP0170') return undefined;
    if (typeof warning === 'object' && warning?.code === 'DEP0170') return undefined;
    return emitWarning.call(process, warning, ...args);
  };
}

/**
 * Database name and hosts with the username and password removed.
 * @param {string} url
 * @returns {{ db: string, hosts: string }}
 */
function describeTarget(url) {
  const withoutCreds = String(url).replace(/\/\/[^@/]+@/, '//');
  const queryIndex = withoutCreds.indexOf('?');
  const base = queryIndex === -1 ? withoutCreds : withoutCreds.slice(0, queryIndex);
  const scheme = base.indexOf('://');
  const pathStart = base.indexOf('/', scheme + 3);
  const hosts = pathStart === -1 ? base.slice(scheme + 3) : base.slice(scheme + 3, pathStart);
  const db = pathStart === -1 || pathStart >= base.length - 1 ? '(default)' : base.slice(pathStart + 1);
  return { db, hosts };
}

/**
 * Refuses a run that did not name the target environment on purpose.
 * @param {string[]} argv
 */
function assertConfirmed(argv) {
  if (cfg.env !== 'development' && cfg.env !== 'production') {
    throw new Error(`Refusing to delete racks when NODE_ENV is ${cfg.env}.`);
  }
  if (!argv.includes('--yes')) {
    throw new Error('Refusing to delete. Pass --yes. On production also pass --production.');
  }
  if (cfg.env === 'production' && !argv.includes('--production')) {
    throw new Error('Refusing to delete production racks. Pass --yes --production.');
  }
}

/**
 * Rolls whose latest movement still names one of these rack codes.
 * @param {string[]} codes
 * @returns {Promise<number>}
 */
async function rollsOnCodes(codes) {
  const taken = new Set(codes);
  const rows = await StockMovement.find({ entityType: 'roll' }).sort({ createdAt: 1 }).select('entityId toLocation').lean();
  const latest = new Map();
  rows.forEach((row) => latest.set(row.entityId, row.toLocation || ''));
  let count = 0;
  latest.forEach((location) => {
    if (taken.has(location) && !OFF_RACK.has(location)) count += 1;
  });
  return count;
}

/**
 * Deletes every storage rack and prints the target database without credentials.
 */
async function main() {
  silenceMongoUrlWarning();
  assertConfirmed(process.argv.slice(2));
  const target = describeTarget(cfg.mongoose.url);
  console.log(`Target ${cfg.env} database "${target.db}" on ${target.hosts}`);
  await mongoose.connect(cfg.mongoose.url, cfg.mongoose.options);
  try {
    const racks = await StorageRack.find().select('code').lean();
    const codes = racks.map((rack) => rack.code);
    const sitting = await rollsOnCodes(codes);
    const result = await StorageRack.deleteMany({});
    const left = await StorageRack.countDocuments();
    console.log(`Deleted ${result.deletedCount} racks. Remaining ${left}.`);
    console.log(`Rolls still pointing at those codes: ${sitting}. Movements were not changed.`);
    if (codes.length) console.log(codes.join('\n'));
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : 'Could not delete racks';
  console.error(message);
  process.exitCode = 1;
});
