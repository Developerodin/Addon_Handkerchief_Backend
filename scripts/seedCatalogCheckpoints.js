import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from '../src/models/user.model.js';
import { CheckpointItem, CheckpointLog, CheckpointModule } from '../src/models/checkpoint.model.js';

dotenv.config();

const MODULE_NAME = 'Master Catalog';

/** Screen-level titles from the first catalog seed. Removed only when they have no checks and no logs. */
const LEGACY_TITLES = [
  'Items',
  'Category',
  'Style codes',
  'Style code combos',
  'Fabric catalog',
  'Fabric type',
  'Fabric color',
  'Fabric quality',
  'Yarn',
  'Count',
  'Measurement',
  'Fabric suppliers',
  'Packaging materials',
  'Process master',
  'Attributes master',
  'Machines and configuration',
  'Workers and operators',
  'Storage racks',
  'Containers',
  'Label templates',
  'Device registry',
];

/**
 * One checklist row: screen, feature, and the detail shown under the title.
 * @param {string} screen
 * @param {string} feature
 * @param {string} detail
 * @returns {{ title: string, description: string }}
 */
const row = (screen, feature, detail) => ({
  title: `${screen} — ${feature}`,
  description: detail,
});

/** @type {Array<[string, string, string]>} */
const FEATURES = [
  ['Items', 'Create', 'Create a product at /catalog/items/add.'],
  ['Items', 'Edit', 'Edit a product at /catalog/items/[id]/edit.'],
  ['Items', 'Delete', 'Delete a product from the items list.'],
  ['Items', 'Image upload', 'Upload a product image on create and edit.'],
  ['Items', 'Attributes', 'Set attribute values on the product.'],
  ['Items', 'Fabric BOM and packaging', 'Set fabric catalogues, metres per piece, and packaging on the BOM.'],
  ['Items', 'Processes', 'Attach manufacturing processes to the product.'],
  ['Items', 'Search and list', 'Search, paginate, and open the items list at /catalog/items.'],
  ['Items', 'Excel import', 'Import products from Excel.'],
  ['Items', 'Excel export', 'Export products to Excel.'],
  ['Category', 'Create', 'Create a category at /catalog/categories/add.'],
  ['Category', 'Edit', 'Edit a category.'],
  ['Category', 'Delete', 'Delete a category at any level.'],
  ['Category', '3-level hierarchy', 'Category, child, and grandchild levels.'],
  ['Category', 'Search', 'Search and paginate categories.'],
  ['Category', 'Excel import', 'Import categories from Excel.'],
  ['Category', 'Excel export', 'Export categories to Excel.'],
  ['Style codes', 'Create', 'Create a style code at /catalog/style-codes/add.'],
  ['Style codes', 'Edit', 'Edit a style code.'],
  ['Style codes', 'Delete', 'Delete a style code.'],
  ['Style codes', 'EAN MRP brand pack', 'EAN, MRP, brand, pack, and bundle or carton quantities.'],
  ['Style codes', 'Status filter', 'Filter the list by active or inactive.'],
  ['Style codes', 'Excel import', 'Import style codes from Excel.'],
  ['Style codes', 'Excel export', 'Export style codes to Excel.'],
  ['Style codes', 'BOM import', 'Import BOM assignments from the BOM Excel template.'],
  ['Style code combos', 'Create', 'Create a combo at /catalog/style-code-combos/add.'],
  ['Style code combos', 'Edit', 'Edit a combo.'],
  ['Style code combos', 'Delete', 'Delete a combo.'],
  ['Style code combos', 'Component style codes', 'Bundle component style codes on the combo.'],
  ['Style code combos', 'Status filter', 'Filter combos by active or inactive.'],
  ['Style code combos', 'Excel import', 'Import combos and component style codes from Excel.'],
  ['Style code combos', 'Excel export', 'Export combos to Excel.'],
  ['Fabric catalog', 'Create', 'Create a fabric at /catalog/fabric/add.'],
  ['Fabric catalog', 'Edit', 'Edit a fabric.'],
  ['Fabric catalog', 'Delete', 'Delete a fabric.'],
  ['Fabric catalog', 'Lookup composition and built name', 'Name is built from type, color, quality, yarn, and count.'],
  ['Fabric catalog', 'Mill sort GSM width rate HSN', 'Mill sort, design, wash, finish, stitch, GSM, width, rate, HSN, and GST.'],
  ['Fabric catalog', 'Status', 'Set the fabric active or inactive.'],
  ['Fabric catalog', 'Search', 'Search and paginate the fabric master.'],
  ['Fabric catalog', 'Excel import', 'Import fabrics from Excel. Leave Name off the sheet.'],
  ['Fabric catalog', 'Excel export', 'Export fabrics to Excel.'],
  ['Fabric type', 'Create', 'Create a fabric type at /catalog/fabric-type/add.'],
  ['Fabric type', 'Edit', 'Edit a fabric type.'],
  ['Fabric type', 'Delete', 'Delete a fabric type.'],
  ['Fabric type', 'Status', 'Set the fabric type active or inactive.'],
  ['Fabric type', 'Excel import', 'Import fabric types from Excel.'],
  ['Fabric type', 'Excel export', 'Export fabric types to Excel.'],
  ['Yarn', 'Create', 'Create a yarn at /catalog/fabric-yarn/add.'],
  ['Yarn', 'Edit', 'Edit a yarn.'],
  ['Yarn', 'Delete', 'Delete a yarn.'],
  ['Yarn', 'Status', 'Set the yarn active or inactive.'],
  ['Yarn', 'Excel import', 'Import yarns from Excel.'],
  ['Yarn', 'Excel export', 'Export yarns to Excel.'],
  ['Count', 'Create', 'Create a count at /catalog/fabric-count/add.'],
  ['Count', 'Edit', 'Edit a count.'],
  ['Count', 'Delete', 'Delete a count.'],
  ['Count', 'Status', 'Set the count active or inactive.'],
  ['Count', 'Excel import', 'Import counts from Excel.'],
  ['Count', 'Excel export', 'Export counts to Excel.'],
  ['Measurement', 'Create', 'Create a measurement at /catalog/fabric-measurement/add.'],
  ['Measurement', 'Edit', 'Edit a measurement.'],
  ['Measurement', 'Delete', 'Delete a measurement.'],
  ['Measurement', 'Status', 'Set the measurement active or inactive.'],
  ['Measurement', 'Excel import', 'Import measurements from Excel.'],
  ['Measurement', 'Excel export', 'Export measurements to Excel.'],
  ['Fabric color', 'Create', 'Create a fabric color at /catalog/fabric-color/add.'],
  ['Fabric color', 'Edit', 'Edit a fabric color.'],
  ['Fabric color', 'Delete', 'Delete a fabric color.'],
  ['Fabric color', 'Hex or Pantone code', 'Store a hex value or a Pantone reference.'],
  ['Fabric color', 'Status', 'Set the color active or inactive.'],
  ['Fabric color', 'Excel import', 'Import colors from Excel.'],
  ['Fabric color', 'Excel export', 'Export colors to Excel.'],
  ['Fabric quality', 'Create', 'Create a fabric quality at /catalog/fabric-quality/add.'],
  ['Fabric quality', 'Edit', 'Edit a fabric quality.'],
  ['Fabric quality', 'Delete', 'Delete a fabric quality.'],
  ['Fabric quality', 'Composition and fiber', 'Composition, primary fiber, and secondary fiber.'],
  ['Fabric quality', 'Grade', 'Set the quality grade.'],
  ['Fabric quality', 'Status', 'Set the quality active or inactive.'],
  ['Fabric quality', 'Excel import', 'Import qualities from Excel.'],
  ['Fabric quality', 'Excel export', 'Export qualities to Excel.'],
  ['Fabric suppliers', 'Create', 'Create a supplier at /catalog/fabric-suppliers/add.'],
  ['Fabric suppliers', 'Edit', 'Edit a supplier.'],
  ['Fabric suppliers', 'Delete', 'Delete a supplier.'],
  ['Fabric suppliers', 'Contact and GST', 'Contact person, phone, email, address, and GSTIN.'],
  ['Fabric suppliers', 'Payment terms and bank', 'Payment terms, lead time, and bank details.'],
  ['Fabric suppliers', 'Excel import', 'Import suppliers from Excel.'],
  ['Fabric suppliers', 'Excel export', 'Export suppliers to Excel.'],
  ['Packaging materials', 'Create', 'Create a packaging material at /catalog/raw-material/add.'],
  ['Packaging materials', 'Edit', 'Edit a packaging material.'],
  ['Packaging materials', 'Delete', 'Delete a packaging material.'],
  ['Packaging materials', 'Type unit rate HSN GST min stock', 'Type, size, unit, rate, HSN, GST, and minimum stock.'],
  ['Packaging materials', 'Supplier', 'Link the packaging material to a supplier.'],
  ['Packaging materials', 'Excel import', 'Import packaging materials from Excel.'],
  ['Packaging materials', 'Excel export', 'Export packaging materials to Excel.'],
  ['Process master', 'Create', 'Create a process at /catalog/processes/add.'],
  ['Process master', 'Edit', 'Edit a process.'],
  ['Process master', 'Delete', 'Delete a process.'],
  ['Process master', 'Department and type', 'Code, department, and process type.'],
  ['Process master', 'Time machine QC rework', 'Time, machine type, QC flag, and rework flag.'],
  ['Process master', 'Process steps', 'Add and edit the steps on the process.'],
  ['Process master', 'Status', 'Set the process active or inactive.'],
  ['Process master', 'Excel import', 'Import processes from the handkerchief Excel template.'],
  ['Process master', 'Excel export', 'Export processes to Excel.'],
  ['Attributes master', 'Create', 'Create an attribute at /catalog/attributes/add.'],
  ['Attributes master', 'Edit', 'Edit an attribute.'],
  ['Attributes master', 'Delete', 'Delete an attribute.'],
  ['Attributes master', 'Allowed values', 'Maintain the allowed values for the attribute.'],
  ['Attributes master', 'Required and category limit', 'Mark an attribute required and limit it to categories.'],
  ['Attributes master', 'Excel import', 'Import attributes from Excel.'],
  ['Attributes master', 'Excel export', 'Export attributes to Excel.'],
  ['Machines', 'Create', 'Create a machine at /catalog/machines/add.'],
  ['Machines', 'Edit', 'Edit a machine.'],
  ['Machines', 'Delete', 'Delete a machine.'],
  ['Machines', 'Type and department', 'Machine type, make, department, and floor.'],
  ['Machines', 'Capacity and maintenance', 'Capacity per shift and the maintenance schedule.'],
  ['Machines', 'Supervisor', 'Assign a supervisor to the machine.'],
  ['Machines', 'Excel import', 'Import machines from Excel.'],
  ['Machines', 'Excel export', 'Export machines to Excel.'],
  ['Workers', 'Create', 'Create a worker at /catalog/workers/add.'],
  ['Workers', 'Edit', 'Edit a worker.'],
  ['Workers', 'Delete', 'Delete a worker.'],
  ['Workers', 'Department and supervisor', 'Employee details, department, and supervisor.'],
  ['Workers', 'Skills and shift', 'Skills and shift assignment.'],
  ['Workers', 'Excel import', 'Import workers from Excel by ID or employee code.'],
  ['Workers', 'Excel export', 'Export workers to Excel.'],
  ['Storage racks', 'Create', 'Create a rack at /catalog/storage-racks/add.'],
  ['Storage racks', 'Edit', 'Edit a rack.'],
  ['Storage racks', 'Delete', 'Delete a rack.'],
  ['Storage racks', 'Location and stock type', 'Location and the stock type the rack holds.'],
  ['Storage racks', 'Capacity and barcode', 'Capacity and barcode identifier.'],
  ['Storage racks', 'Excel import', 'Import racks from Excel by ID or code.'],
  ['Storage racks', 'Excel export', 'Export racks to Excel.'],
  ['Containers', 'Create', 'Create a container at /catalog/containers/add.'],
  ['Containers', 'Edit', 'Edit a container.'],
  ['Containers', 'Delete', 'Delete a container.'],
  ['Containers', 'Type and floor', 'Bundles, cartons, trolleys, and crates, with department and floor.'],
  ['Containers', 'Excel import', 'Import containers from Excel by ID or code.'],
  ['Containers', 'Excel export', 'Export containers to Excel.'],
  ['Label templates', 'Create', 'Create a label template at /catalog/label-templates/add.'],
  ['Label templates', 'Edit', 'Edit a label template.'],
  ['Label templates', 'Delete', 'Delete a label template.'],
  ['Label templates', 'Label type and barcode', 'Label type, size, encoded fields, and barcode scheme.'],
  ['Label templates', 'Printer', 'Assign a printer device to the template.'],
  ['Label templates', 'Bulk delete', 'Delete the selected label templates together.'],
  ['Label templates', 'Excel import', 'Import label templates from Excel.'],
  ['Label templates', 'Excel export', 'Export label templates to Excel.'],
  ['Device registry', 'Create', 'Create a device from the label templates screen, devices tab.'],
  ['Device registry', 'Edit', 'Edit a printer or scanner.'],
  ['Device registry', 'Delete', 'Delete a device.'],
  ['Device registry', 'Printer and scanner', 'Device type is printer or scanner, with scanner type when needed.'],
  ['Device registry', 'Model and location', 'Model, location, and label size.'],
  ['Device registry', 'Bulk delete', 'Delete the selected devices together.'],
  ['Device registry', 'Excel import', 'Import devices from Excel.'],
  ['Device registry', 'Excel export', 'Export devices to Excel.'],
];

const CHECKPOINTS = FEATURES.map(([screen, feature, detail]) => row(screen, feature, detail));

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
 * True when a coarse row was never checked and has no log.
 * @param {import('mongoose').Document} item
 * @returns {Promise<boolean>}
 */
const isUnusedLegacy = async (item) => {
  const checked = Boolean(
    item.developerChecked ||
      item.addonChecked ||
      item.developedChecked ||
      item.testedOdinChecked ||
      item.testedAddonChecked ||
      item.implemented === true ||
      item.implemented === false ||
      (item.pendencyRemark || '').trim()
  );
  if (checked) return false;
  const logs = await CheckpointLog.countDocuments({ itemId: item._id });
  return logs === 0;
};

/**
 * Drops unsigned screen-level catalog rows so the feature rows replace them.
 * @param {import('mongoose').Document} moduleDoc
 * @returns {Promise<string[]>}
 */
const removeLegacy = async (moduleDoc) => {
  const removed = [];
  for (const title of LEGACY_TITLES) {
    const existing = await CheckpointItem.findOne({ moduleId: moduleDoc._id, title });
    if (!existing) continue;
    if (!(await isUnusedLegacy(existing))) continue;
    await CheckpointLog.deleteMany({ itemId: existing._id });
    await existing.deleteOne();
    removed.push(title);
  }
  return removed;
};

/**
 * Inserts missing feature rows. Existing titles keep their checks.
 * @param {import('mongoose').Document} moduleDoc
 * @returns {Promise<{ created: string[], skipped: string[] }>}
 */
const ensureItems = async (moduleDoc) => {
  const created = [];
  const skipped = [];
  const last = await CheckpointItem.findOne({ moduleId: moduleDoc._id }).sort({ sortOrder: -1 }).select('sortOrder').lean();
  let sortOrder = last?.sortOrder ?? 0;

  for (const checkpoint of CHECKPOINTS) {
    const existing = await CheckpointItem.findOne({ moduleId: moduleDoc._id, title: checkpoint.title });
    if (existing) {
      skipped.push(checkpoint.title);
      continue;
    }
    sortOrder += 1;
    await CheckpointItem.create({
      moduleId: moduleDoc._id,
      title: checkpoint.title,
      description: checkpoint.description,
      sortOrder,
    });
    created.push(checkpoint.title);
  }

  return { created, skipped };
};

/**
 * Seeds Master Catalog feature rows. Safe to run again: it skips existing titles
 * and only deletes the old screen-level rows when they have no checks and no logs.
 */
const seedCatalogCheckpoints = async () => {
  const safeUrl = await connect();
  const owner = await findOwner();
  const { doc, created: moduleCreated } = await ensureModule(owner);
  const removed = await removeLegacy(doc);
  const { created, skipped } = await ensureItems(doc);

  console.log(`Database: ${safeUrl}`);
  console.log(`Module: ${MODULE_NAME} (${moduleCreated ? 'created' : 'already present'})`);
  console.log(`Removed unsigned screen rows ${removed.length}:`);
  removed.forEach((title) => console.log(`  - ${title}`));
  console.log(`Created ${created.length}:`);
  created.forEach((title) => console.log(`  + ${title}`));
  console.log(`Already present ${skipped.length}`);

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
