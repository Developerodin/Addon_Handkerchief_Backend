/**
 * Rewrite FabricCatalog.name from type, color, quality, yarn, and count.
 * Also refreshes the copied fabricName on product BOM lines and fabric suppliers.
 *
 * Dry run: node scripts/fix-fabric-catalog-names.js --dry-run
 * Apply:   node scripts/fix-fabric-catalog-names.js
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import FabricCatalog from '../src/models/fabricCatalog.model.js';
import FabricType from '../src/models/fabricType.model.js';
import FabricColor from '../src/models/fabricColor.model.js';
import FabricQuality from '../src/models/fabricQuality.model.js';
import FabricYarn from '../src/models/fabricYarn.model.js';
import FabricCount from '../src/models/fabricCount.model.js';
import Product from '../src/models/product.model.js';
import FabricSupplier from '../src/models/fabricSupplier.model.js';
import { buildFabricCatalogName } from '../src/utils/fabricCatalogName.util.js';

dotenv.config();

const dryRun = process.argv.includes('--dry-run');

/**
 * Map lookup ids to their current names.
 * @param {import('mongoose').Model} Model
 * @param {string[]} ids
 * @returns {Promise<Map<string, string>>}
 */
async function loadNames(Model, ids) {
  if (!ids.length) return new Map();
  const docs = await Model.find({ _id: { $in: ids } }).select('name').lean();
  return new Map(docs.map((doc) => [String(doc._id), String(doc.name || '').trim()]));
}

/**
 * Prefer the live lookup name. Fall back to the name already stored on the catalog.
 * @param {Map<string, string>} names
 * @param {unknown} id
 * @param {string} stored
 * @returns {string}
 */
function resolveName(names, id, stored) {
  if (id) {
    const live = names.get(String(id));
    if (live) return live;
  }
  return String(stored || '').trim();
}

/**
 * Copy the new catalog name onto product BOM lines and supplier fabric rows.
 * @param {import('mongoose').Types.ObjectId} catalogId
 * @param {string} name
 * @returns {Promise<{ products: number, suppliers: number }>}
 */
async function syncCopiedNames(catalogId, name) {
  const [products, suppliers] = await Promise.all([
    Product.updateMany(
      { 'bom.fabricCatalogId': catalogId },
      { $set: { 'bom.$[line].fabricName': name } },
      { arrayFilters: [{ 'line.fabricCatalogId': catalogId }] }
    ),
    FabricSupplier.updateMany(
      { 'fabricDetails.fabricCatalogId': catalogId },
      { $set: { 'fabricDetails.$[line].fabricName': name } },
      { arrayFilters: [{ 'line.fabricCatalogId': catalogId }] }
    ),
  ]);
  return {
    products: products.nModified ?? products.modifiedCount ?? 0,
    suppliers: suppliers.nModified ?? suppliers.modifiedCount ?? 0,
  };
}

/**
 * Rebuild stored fabric names and print a summary.
 * @returns {Promise<void>}
 */
async function main() {
  if (process.env.NODE_ENV === 'test') {
    throw new Error('Refusing to run against the test database');
  }
  const url = process.env.MONGODB_URL;
  if (!url) {
    throw new Error('MONGODB_URL is required');
  }

  await mongoose.connect(url, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });
  const catalogs = await FabricCatalog.find({})
    .select(
      'name fabricType fabricTypeName color colourName quality qualityName yarn yarnName count countName fabricSortNo'
    )
    .lean();

  const idsOf = (key) => [...new Set(catalogs.map((row) => row[key]).filter(Boolean).map(String))];
  const [types, colors, qualities, yarns, counts] = await Promise.all([
    loadNames(FabricType, idsOf('fabricType')),
    loadNames(FabricColor, idsOf('color')),
    loadNames(FabricQuality, idsOf('quality')),
    loadNames(FabricYarn, idsOf('yarn')),
    loadNames(FabricCount, idsOf('count')),
  ]);

  const updates = [];
  const skipped = [];
  let unchanged = 0;

  for (const row of catalogs) {
    const parts = {
      fabricTypeName: resolveName(types, row.fabricType, row.fabricTypeName),
      colourName: resolveName(colors, row.color, row.colourName),
      qualityName: resolveName(qualities, row.quality, row.qualityName),
      yarnName: resolveName(yarns, row.yarn, row.yarnName),
      countName: resolveName(counts, row.count, row.countName),
    };
    const generated = buildFabricCatalogName(parts);
    if (!generated) {
      skipped.push({ id: String(row._id), name: row.name || '', fabricSortNo: row.fabricSortNo || '' });
      continue;
    }

    const set = {};
    if (generated !== (row.name || '')) set.name = generated;
    ['fabricTypeName', 'colourName', 'qualityName', 'yarnName', 'countName'].forEach((key) => {
      if (parts[key] && parts[key] !== (row[key] || '')) set[key] = parts[key];
    });

    if (!Object.keys(set).length) {
      unchanged += 1;
      continue;
    }
    updates.push({
      id: row._id,
      from: row.name || '',
      to: set.name || row.name || '',
      fabricSortNo: row.fabricSortNo || '',
      set,
    });
  }

  console.log(`Catalogs: ${catalogs.length}`);
  console.log(`Unchanged: ${unchanged}`);
  console.log(`To update: ${updates.length}`);
  console.log(`Skipped (no lookups): ${skipped.length}`);
  updates.forEach((row) => {
    console.log(`${row.fabricSortNo || row.id}: "${row.from}" -> "${row.to}"`);
  });
  skipped.forEach((row) => {
    console.log(`SKIP ${row.fabricSortNo || row.id}: "${row.name}" has no type, color, quality, yarn, or count`);
  });

  if (dryRun) {
    console.log('Dry run. No rows written.');
    await mongoose.disconnect();
    return;
  }

  let productCopies = 0;
  let supplierCopies = 0;
  for (const row of updates) {
    await FabricCatalog.updateOne({ _id: row.id }, { $set: row.set });
    if (row.set.name) {
      const copied = await syncCopiedNames(row.id, row.set.name);
      productCopies += copied.products;
      supplierCopies += copied.suppliers;
    }
  }
  console.log(`Updated catalogs: ${updates.length}`);
  console.log(`Product BOM copies: ${productCopies}`);
  console.log(`Supplier copies: ${supplierCopies}`);
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : error);
  try {
    await mongoose.disconnect();
  } catch (disconnectError) {
    console.error(disconnectError instanceof Error ? disconnectError.message : disconnectError);
  }
  process.exit(1);
});
