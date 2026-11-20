/**
 * Upserts Inline checking (ILC) and splices it into demo items + open order floors.
 *
 *   node --disable-warning=DEP0170 scripts/patchInlineCheckProcess.js
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Process from '../src/models/process.model.js';
import Product from '../src/models/product.model.js';
import { PieceBundle, ProductionOrder } from '../src/models/production.model.js';

dotenv.config();

const ILC = {
  name: 'Inline checking',
  code: 'ILC',
  type: 'checking',
  description: 'Confirm inline checking against a horizontal hemming machine',
  department: 'checking',
  machineType: 'none',
  floor: 'inline-check',
  qcCheckpoint: false,
  sortOrder: 65,
  status: 'active',
};

const CORE_INSERT_AFTER = ['HH', 'ILC', 'THC'];

async function upsertIlc() {
  const existing = await Process.findOne({ code: 'ILC' });
  if (existing) {
    await Process.updateOne({ _id: existing._id }, { $set: ILC });
    return existing;
  }
  return Process.create(ILC);
}

/**
 * @param {string[]} codes ordered process codes
 * @param {Map<string, import('mongoose').Document>} byCode
 */
function processIdsFromCodes(codes, byCode) {
  return codes.map((code) => {
    const row = byCode.get(code);
    if (!row) throw new Error(`Missing process ${code}`);
    return { processId: row._id };
  });
}

async function patchProducts() {
  const all = await Process.find({ status: 'active' }).lean();
  const byCode = new Map(all.map((row) => [row.code, row]));
  const products = await Product.find({ 'processes.0': { $exists: true } });
  let touched = 0;
  for (const product of products) {
    const ids = (product.processes || []).map((row) => String(row.processId)).filter(Boolean);
    const ordered = await Process.find({ _id: { $in: ids } })
      .sort({ sortOrder: 1 })
      .select('code sortOrder _id')
      .lean();
    const codes = ordered.map((row) => row.code).filter(Boolean);
    if (!codes.includes('HH') || codes.includes('ILC')) continue;
    const hhIndex = codes.indexOf('HH');
    const next = [...codes.slice(0, hhIndex + 1), 'ILC', ...codes.slice(hhIndex + 1)];
    const missing = next.filter((code) => !byCode.has(code));
    if (missing.length) {
      console.warn(`Skip product ${product.factoryCode}: missing processes ${missing.join(', ')}`);
      continue;
    }
    product.processes = processIdsFromCodes(next, byCode);
    await product.save();
    touched += 1;
  }
  console.log(`Updated ${touched} catalog item(s) with ILC after HH`);
}

async function patchOpenOrders() {
  const ilc = await Process.findOne({ code: 'ILC' }).lean();
  if (!ilc) throw new Error('ILC process missing');
  const orders = await ProductionOrder.find({ status: { $in: ['released', 'in-progress', 'amended', 'on-hold'] } });
  let touched = 0;
  for (const order of orders) {
    const floors = order.floors || [];
    const hasInline = floors.some((step) => step.floor === 'inline-check');
    if (hasInline) continue;
    const hhIndex = floors.findIndex((step) => step.floor === 'horizontal-hem');
    if (hhIndex < 0) continue;
    const step = {
      processId: String(ilc._id),
      name: ilc.name,
      floor: 'inline-check',
      sortOrder: (floors[hhIndex].sortOrder || 0) + 0.5,
      receivedQty: floors[hhIndex + 1]?.receivedQty || 0,
      completedQty: 0,
      transferredQty: 0,
    };
    floors.splice(hhIndex + 1, 0, step);
    order.floors = floors;
    await order.save();
    touched += 1;
  }
  console.log(`Inserted inline-check floor on ${touched} open order(s)`);
}

async function resetStuckBundles() {
  const result = await PieceBundle.updateMany({ process: 'inline-check' }, { $set: { process: 'horizontal-hem' } });
  console.log(`Reset ${result.modifiedCount || 0} bundle(s) from inline-check to horizontal-hem`);
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URL);
  await upsertIlc();
  console.log('ILC process ready');
  await patchProducts();
  await patchOpenOrders();
  await resetStuckBundles();
  console.log('Done. Expected code order fragment:', CORE_INSERT_AFTER.join(' → '));
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});