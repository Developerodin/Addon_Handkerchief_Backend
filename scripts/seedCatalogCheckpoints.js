import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from '../src/models/user.model.js';
import { CheckpointItem, CheckpointModule } from '../src/models/checkpoint.model.js';

dotenv.config();

const MODULE_NAME = 'Master Catalog';

/**
 * One checkpoint per Master Catalog screen. Each row covers create, edit, delete,
 * and the extra actions on that screen.
 */
const CHECKPOINTS = [
  {
    title: 'Items',
    description:
      'Items at /catalog/items. Create, edit, and delete a product. Also image upload, attributes, fabric BOM and packaging, processes, search, and Excel import and export.',
  },
  {
    title: 'Category',
    description:
      'Categories at /catalog/categories. Create, edit, and delete at any level of Category, Child, and Grandchild. Also search and Excel import and export.',
  },
  {
    title: 'Style codes',
    description:
      'Style codes at /catalog/style-codes. Create, edit, and delete. Also EAN, MRP, brand, pack, bundle and carton quantities, active/inactive filter, Excel import and export, and BOM import.',
  },
  {
    title: 'Style code combos',
    description:
      'Style code combos at /catalog/style-code-combos. Create, edit, and delete a combo of style codes. Also shared EAN, MRP, pack, status filter, and Excel import and export of component style codes.',
  },
  {
    title: 'Fabric catalog',
    description:
      'Fabric master at /catalog/fabric. Create, edit, and delete. Also mill sort, type, color, quality, yarn, count, design, wash, finish, stitch, GSM, width, rate, HSN/GST, status, search, and Excel import and export. Name is built from the lookups.',
  },
  {
    title: 'Fabric type',
    description:
      'Fabric type at /catalog/fabric-type. Create, edit, and delete. Also status and Excel import and export for the fabric master dropdown.',
  },
  {
    title: 'Fabric color',
    description:
      'Fabric color at /catalog/fabric-color. Create, edit, and delete. Also hex or Pantone color code, status, and Excel import and export.',
  },
  {
    title: 'Fabric quality',
    description:
      'Fabric quality at /catalog/fabric-quality. Create, edit, and delete. Also composition, fiber, grade, remarks, status, and Excel import and export.',
  },
  {
    title: 'Yarn',
    description:
      'Yarn at /catalog/fabric-yarn. Create, edit, and delete. Also status and Excel import and export for the fabric master dropdown.',
  },
  {
    title: 'Count',
    description:
      'Count at /catalog/fabric-count. Create, edit, and delete. Also status and Excel import and export for the fabric master dropdown.',
  },
  {
    title: 'Measurement',
    description:
      'Measurement at /catalog/fabric-measurement. Create, edit, and delete. Also status and Excel import and export for the fabric master dropdown.',
  },
  {
    title: 'Fabric suppliers',
    description:
      'Fabric suppliers at /catalog/fabric-suppliers. Create, edit, and delete. Also contact, GST, payment terms, lead time, bank details, and Excel import and export.',
  },
  {
    title: 'Packaging materials',
    description:
      'Packaging materials at /catalog/raw-material. Create, edit, and delete. Also type, size, supplier, unit, rate, HSN, GST, minimum stock, and Excel import and export.',
  },
  {
    title: 'Process master',
    description:
      'Process master at /catalog/processes. Create, edit, and delete. Also code, department, type, time, machine type, QC and rework flags, process steps, status, and Excel import and export.',
  },
  {
    title: 'Attributes master',
    description:
      'Attributes master at /catalog/attributes. Create, edit, and delete. Also allowed values, required flag, category limit, and Excel import and export.',
  },
  {
    title: 'Machines and configuration',
    description:
      'Machines at /catalog/machines. Create, edit, and delete. Also type, department, floor, capacity, maintenance schedule, supervisor, status, and Excel import and export.',
  },
  {
    title: 'Workers and operators',
    description:
      'Workers at /catalog/workers. Create, edit, and delete. Also employee details, department, supervisor, skills, shift, and Excel import and export.',
  },
  {
    title: 'Storage racks',
    description:
      'Storage racks at /catalog/storage-racks. Create, edit, and delete. Also location, stock type, capacity, barcode, and Excel import and export.',
  },
  {
    title: 'Containers',
    description:
      'Containers at /catalog/containers. Create, edit, and delete bundles, cartons, trolleys, and crates. Also department, floor, and Excel import and export.',
  },
  {
    title: 'Label templates',
    description:
      'Label templates at /catalog/label-templates. Create, edit, and delete. Also label type, size, encoded fields, barcode scheme, printer, status, bulk delete, and Excel import and export.',
  },
  {
    title: 'Device registry',
    description:
      'Device registry on the same screen as label templates. Create, edit, and delete printers and scanners. Also model, location, label size, scanner type, status, bulk delete, and Excel import and export.',
  },
];

/**
 * Connects with MONGODB_URL. Pass a different URL to seed another database.
 * @returns {Promise<string>}
 */
const connect = async () => {
  const url = process.env.MONGODB_URL;
  if (!url) {
    throw new Error('MONGODB_URL is required. Set it in .env or pass it on the command.');
  }
  await mongoose.connect(url, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });
  return url.replace(/\/\/([^:]+):([^@]+)@/, '//$1:***@');
};

/**
 * User stored as createdBy on a new module.
 * @returns {Promise<import('mongoose').Document>}
 */
const findOwner = async () => {
  const owner = await User.findOne({ email: 'superadmin@addon.in' });
  if (owner) return owner;
  const fallback = await User.findOne({ role: { $in: ['super_admin', 'admin'] } }).sort({ createdAt: 1 });
  if (!fallback) {
    throw new Error('No super_admin or admin user found. Seed a user before checkpoints.');
  }
  return fallback;
};

/**
 * Creates the Master Catalog module when it is missing.
 * @param {import('mongoose').Document} owner
 * @returns {Promise<{ doc: import('mongoose').Document, created: boolean }>}
 */
const ensureModule = async (owner) => {
  const existing = await CheckpointModule.findOne({ name: MODULE_NAME });
  if (existing) return { doc: existing, created: false };

  const last = await CheckpointModule.findOne().sort({ sortOrder: -1 }).select('sortOrder').lean();
  const doc = await CheckpointModule.create({
    name: MODULE_NAME,
    sortOrder: (last?.sortOrder ?? 0) + 1,
    createdBy: owner._id,
  });
  return { doc, created: true };
};

/**
 * Inserts missing checkpoints. Existing titles keep their sign-off and description.
 * @param {import('mongoose').Document} moduleDoc
 * @returns {Promise<{ created: string[], skipped: string[] }>}
 */
const ensureItems = async (moduleDoc) => {
  const created = [];
  const skipped = [];
  const last = await CheckpointItem.findOne({ moduleId: moduleDoc._id }).sort({ sortOrder: -1 }).select('sortOrder').lean();
  let sortOrder = last?.sortOrder ?? 0;

  for (const row of CHECKPOINTS) {
    const existing = await CheckpointItem.findOne({ moduleId: moduleDoc._id, title: row.title });
    if (existing) {
      skipped.push(row.title);
      continue;
    }
    sortOrder += 1;
    await CheckpointItem.create({
      moduleId: moduleDoc._id,
      title: row.title,
      description: row.description,
      sortOrder,
    });
    created.push(row.title);
  }

  return { created, skipped };
};

/**
 * Seeds Master Catalog checkpoints. Safe to run again and safe on production:
 * it only inserts a missing module and missing titles.
 */
const seedCatalogCheckpoints = async () => {
  const safeUrl = await connect();
  const owner = await findOwner();
  const { doc, created: moduleCreated } = await ensureModule(owner);
  const { created, skipped } = await ensureItems(doc);

  console.log(`Database: ${safeUrl}`);
  console.log(`Module: ${MODULE_NAME} (${moduleCreated ? 'created' : 'already present'})`);
  console.log(`Created ${created.length}:`);
  created.forEach((title) => console.log(`  + ${title}`));
  console.log(`Already present ${skipped.length}:`);
  skipped.forEach((title) => console.log(`  = ${title}`));

  await mongoose.disconnect();
};

seedCatalogCheckpoints().catch(async (err) => {
  console.error(err instanceof Error ? err.message : err);
  try {
    await mongoose.disconnect();
  } catch (disconnectErr) {
    console.error(disconnectErr instanceof Error ? disconnectErr.message : disconnectErr);
  }
  process.exit(1);
});
