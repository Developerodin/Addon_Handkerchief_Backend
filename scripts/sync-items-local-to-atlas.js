/**
 * Copy catalog products from local EC2 MongoDB into Atlas (process master must be synced first).
 *
 *   npm run sync:processes-local
 *   npm run sync:items-local
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import config from '../src/config/config.js';
import Category from '../src/models/category.model.js';
import FabricCatalog from '../src/models/fabricCatalog.model.js';
import Process from '../src/models/process.model.js';
import Product from '../src/models/product.model.js';
import RawMaterial from '../src/models/rawMaterial.model.js';
import { publishItemDefinition } from '../src/services/catalogPublish.service.js';

dotenv.config();

const localUrl = process.env.LOCAL_MONGODB_URL || 'mongodb://127.0.0.1:27017/handkerchief';
const atlasUrl = process.env.MONGODB_URL || config.mongoose.url;

/** @param {import('mongodb').Db} db */
async function loadLocalMasters(db) {
  const [products, processes, fabrics, categories, rawMaterials] = await Promise.all([
    db.collection('products').find({ status: { $ne: 'inactive' } }).toArray(),
    db.collection('processes').find({}).toArray(),
    db.collection('fabriccatalogs').find({}).toArray(),
    db.collection('categories').find({}).toArray(),
    db.collection('rawmaterials').find({}).toArray(),
  ]);
  const processById = new Map(processes.map((row) => [String(row._id), row]));
  const fabricById = new Map(fabrics.map((row) => [String(row._id), row]));
  const categoryById = new Map(categories.map((row) => [String(row._id), row]));
  const rawById = new Map(rawMaterials.map((row) => [String(row._id), row]));
  return { products, processById, fabricById, categoryById, rawById };
}

await mongoose.connect(localUrl, { useNewUrlParser: true, useUnifiedTopology: true });
const masters = await loadLocalMasters(mongoose.connection.db);
console.log(`Local: ${masters.products.length} product(s), ${masters.processById.size} process(es)`);
await mongoose.disconnect();

await mongoose.connect(atlasUrl, config.mongoose.options || {});

const atlasProcesses = await Process.find({}).lean();
const atlasProcessByCode = new Map();
for (const row of atlasProcesses) {
  if (row.code) atlasProcessByCode.set(`code:${row.code}`, row._id);
  atlasProcessByCode.set(`name:${String(row.name).trim().toLowerCase()}`, row._id);
}

const atlasFabrics = await FabricCatalog.find({}).select('fabricSortNo name rate').lean();
const atlasFabricsBySort = new Map();
for (const f of atlasFabrics) {
  const sortNo = String(f.fabricSortNo || '').trim();
  if (sortNo) atlasFabricsBySort.set(sortNo, f);
}

/**
 * @param {string} localProcessId
 */
function mapProcessId(localProcessId) {
  const row = masters.processById.get(String(localProcessId));
  if (!row) return null;
  const code = String(row.code || '').trim();
  if (code && atlasProcessByCode.has(`code:${code}`)) return atlasProcessByCode.get(`code:${code}`);
  return atlasProcessByCode.get(`name:${String(row.name).trim().toLowerCase()}`) || null;
}

/**
 * @param {string} localFabricId
 */
async function mapFabric(localFabricId) {
  const row = masters.fabricById.get(String(localFabricId));
  if (!row) return { fabricCatalogId: null, fabricName: '', unitCost: 0 };
  const sortNo = String(row.fabricSortNo || row.sortNo || '').trim();
  let atlas = sortNo ? atlasFabricsBySort.get(sortNo) : null;
  if (!atlas && row.name) {
    atlas = await FabricCatalog.findOne({ name: new RegExp(`^${String(row.name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }).lean();
  }
  if (!atlas) {
    console.warn(`  Fabric missing on Atlas: sortNo=${sortNo || '—'} name=${row.name || ''}`);
    return { fabricCatalogId: null, fabricName: row.name || '', unitCost: Number(row.rate) || 0 };
  }
  return { fabricCatalogId: atlas._id, fabricName: atlas.name, unitCost: Number(atlas.rate) || 0 };
}

async function mapCategory(localCategoryId) {
  const row = masters.categoryById.get(String(localCategoryId));
  if (!row) {
    const fallback = await Category.findOne({ status: 'active' }).sort({ sortOrder: 1 });
    return fallback?._id;
  }
  let cat = await Category.findOne({ name: row.name });
  if (!cat) {
    cat = await Category.create({
      name: row.name,
      description: row.description || 'Synced from local',
      status: 'active',
      sortOrder: row.sortOrder || 0,
    });
  }
  return cat._id;
}

async function mapRawMaterial(localId) {
  const row = masters.rawById.get(String(localId));
  if (!row) return null;
  let material = await RawMaterial.findOne({ name: row.name });
  if (!material) {
    material = await RawMaterial.create({
      name: row.name,
      type: row.type || 'thread',
      groupName: row.groupName || 'Thread',
      description: row.description || 'Synced from local',
      unit: row.unit || 'Kg',
      status: 'active',
    });
  }
  return material._id;
}

const synced = [];
for (const src of masters.products) {
  const softwareCode = String(src.softwareCode || src.factoryCode || '').trim();
  if (!softwareCode) continue;

  const categoryId = await mapCategory(src.category);
  const bom = [];
  for (const line of src.bom || []) {
    const fabricRef = line.fabricCatalogId;
    const mapped = await mapFabric(String(fabricRef));
    bom.push({
      bomLineId: line.bomLineId || '',
      fabricCatalogId: mapped.fabricCatalogId,
      fabricName: mapped.fabricName || line.fabricName,
      quantity: Number(line.quantity) || 0,
      piecesPerMeter: Number(line.piecesPerMeter) || 0,
      sizeLabel: line.sizeLabel || '',
      uom: line.uom || 'CM',
      unitCost: Number(line.unitCost) || mapped.unitCost || 0,
    });
  }

  const processes = [];
  for (const line of src.processes || []) {
    const pid = mapProcessId(line.processId);
    if (pid) processes.push({ processId: pid });
  }

  const rawMaterials = [];
  for (const line of src.rawMaterials || []) {
    const rid = await mapRawMaterial(line.rawMaterialId);
    if (!rid) continue;
    rawMaterials.push({
      bomLineId: line.bomLineId || '',
      rawMaterialId: rid,
      quantity: Number(line.quantity) || 0,
      unitCost: Number(line.unitCost) || 0,
      materialRole: line.materialRole || 'packing',
    });
  }

  const attributes = {};
  if (src.attributes && typeof src.attributes === 'object') {
    Object.entries(src.attributes).forEach(([k, v]) => {
      attributes[k] = String(v);
    });
  }

  const payload = {
    name: src.name,
    softwareCode,
    internalCode: src.internalCode || '',
    articleName: src.articleName || '',
    vendorCode: src.vendorCode || '',
    vendorName: src.vendorName || '',
    factoryCode: src.factoryCode || softwareCode,
    hsnCode: src.hsnCode || '',
    gst: src.gst || '',
    materialCode: src.materialCode || '',
    productionType: src.productionType || 'normal',
    piecesPerCut: src.piecesPerCut || 3,
    description: src.description || '',
    category: categoryId,
    status: 'active',
    attributes,
    bom,
    processes,
    rawMaterials,
    unitCost: Number(src.unitCost) || 0,
  };

  let product = await Product.findOne({ $or: [{ softwareCode }, { factoryCode: payload.factoryCode }] });
  if (product) {
    Object.assign(product, payload);
    await product.save();
  } else {
    product = await Product.create(payload);
  }
  await publishItemDefinition(product);
  synced.push(`${payload.factoryCode} · ${payload.productionType} · ${processes.length} processes`);
}

console.log('\nItems on Atlas:');
synced.forEach((line) => console.log(`  ${line}`));
console.log(`\n${synced.length} item(s) → http://localhost:3000/catalog/items/`);

await mongoose.disconnect();