import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from '../src/models/user.model.js';
import { CheckpointItem, CheckpointModule } from '../src/models/checkpoint.model.js';

dotenv.config();

const MODULE_NAME = 'Fabric Management';

/**
 * Fabric Management screens to sign off. Order matches the sidebar, then the
 * reports that are not separate menu items yet.
 * "Inward entries" is the reading of the requested "uncure ethics" checkpoint.
 */
const CHECKPOINTS = [
  {
    title: 'All PO (current POs)',
    description:
      'Purchase management. Current purchase orders at /store/purchase-orders: list, filters, create, edit, submit to supplier, in-transit, and cutoff approval.',
  },
  {
    title: 'PO received',
    description:
      'Purchase management. Goods inward at /store/po-received: record received lots, rolls, quantities, and process the receipt against the PO.',
  },
  {
    title: 'Draft POs',
    description:
      'Purchase management. Draft purchase orders at /store/purchase-orders/drafts: save, edit, and submit before the supplier sees the PO.',
  },
  {
    title: 'PO return',
    description:
      'Purchase management. Vendor return at /store/vendor-returns: scan QC-rejected rolls and send the lot back to the supplier.',
  },
  {
    title: 'PO return challan',
    description:
      'Purchase management. Return challans at /store/return-challans: search, open, and reprint the challan raised from a PO return.',
  },
  {
    title: 'GRN history',
    description:
      'Purchase management. Goods received notes at /store/grn: history, date range, monthly summary, and reprint of a receipt.',
  },
  {
    title: 'Fabric QC',
    description:
      'Purchase management. Fabric QC at /quality/fabric: pending queue, scan rolls, pass, reject, or hold a received lot, and QC history.',
  },
  {
    title: 'Inward entries',
    description:
      'Purchase management. Inward entries for fabric against a PO: the receipt that creates lots and rolls before QC and storage.',
  },
  {
    title: 'Requisition list for fabric items',
    description:
      'Purchase management. Requisition list for fabric items: low or required fabric, quantity, and the path from requisition into a draft PO.',
  },
  {
    title: 'Fabric issue',
    description:
      'Issue stored rolls to a production order and article at /store/issue, including the fabric requirement and the issue log.',
  },
  {
    title: 'Fabric return',
    description:
      'Return an issued roll to a rack at /store/fabric-return so it is back in storage and off the floor.',
  },
  {
    title: 'Fabric storage',
    description:
      'Storage at /store/racks: unallocated rolls, allocated rolls, rack layout, and roll tracker after QC pass.',
  },
  {
    title: 'Live inventory',
    description: 'Analytics. Live inventory at /store/reports/live-inventory: rolls on racks and stored roll count.',
  },
  {
    title: 'Fabric stock report',
    description:
      'Analytics. Fabric stock report at /store/reports/stock: rolls by status (received, stored, held, issued, on floor, returned).',
  },
  {
    title: 'PO report for fabric',
    description:
      'Analytics. PO report at /store/reports/po: purchase orders grouped by status from draft through received and return.',
  },
  {
    title: 'Fabric analytics',
    description:
      'Analytics. Fabric analytics at /store/reports/fabric: QC pending, passed, held, PO received, and vendor returns.',
  },
  {
    title: 'Fabric consumption report',
    description:
      'Analytics. Fabric consumption report: metres issued to orders against the BOM, by fabric item, order, and date.',
  },
  {
    title: 'Suppliers report with QC checks',
    description:
      'Analytics. Supplier report with QC checks: receipts, passed, rejected, and held lots per fabric supplier.',
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
 * User stored as createdBy on a new module. Structure edits in the app use the same roles.
 * @returns {Promise<import('mongoose').Document>}
 */
const findOwner = async () => {
  const user = await User.findOne({ role: { $in: ['super_admin', 'admin'] } }).sort({ createdAt: 1 });
  if (!user) {
    throw new Error('No super_admin or admin user found. Seed a user before checkpoints.');
  }
  return user;
};

/**
 * Creates the Fabric Management module when it is missing. Does not rename other modules.
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
 * Seeds Fabric Management checkpoints. Safe to run again and safe on production:
 * it only inserts a missing module and missing titles.
 */
const seedFabricCheckpoints = async () => {
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

seedFabricCheckpoints().catch(async (err) => {
  console.error(err instanceof Error ? err.message : err);
  try {
    await mongoose.disconnect();
  } catch (disconnectErr) {
    console.error(disconnectErr instanceof Error ? disconnectErr.message : disconnectErr);
  }
  process.exit(1);
});
