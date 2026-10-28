import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from '../src/models/user.model.js';
import { CheckpointItem, CheckpointLog, CheckpointModule } from '../src/models/checkpoint.model.js';

dotenv.config();

const MODULE_NAME = 'Fabric Management';

/** Screen-level titles from the first fabric seed. Removed only when they have no checks and no logs. */
const LEGACY_TITLES = [
  'All PO (current POs)',
  'PO received',
  'Draft POs',
  'PO return',
  'PO return challan',
  'GRN history',
  'Fabric QC',
  'Inward entries',
  'Requisition list for fabric items',
  'Fabric issue',
  'Fabric return',
  'Fabric storage',
  'Live inventory',
  'Fabric stock report',
  'PO report for fabric',
  'Fabric analytics',
  'Fabric consumption report',
  'Suppliers report with QC checks',
];

/**
 * One checklist row.
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
  ['All PO', 'Create', 'Create a purchase order at /store/purchase-orders/add.'],
  ['All PO', 'Edit', 'Edit a draft or a PO that is still submitted to the vendor.'],
  ['All PO', 'View', 'Open a PO and its lots from the current PO list.'],
  ['All PO', 'List and filters', 'Search and filter current purchase orders at /store/purchase-orders.'],
  ['All PO', 'Submit to supplier', 'Submit a draft so the supplier can see the PO.'],
  ['All PO', 'Mark in transit', 'Mark a submitted, partial, or in-transit PO as in transit.'],
  ['All PO', 'Cutoff approval', 'Approve or reject the fabric cutoff on a PO.'],
  ['All PO', 'Open lot', 'Open a lot from the fabric lines of a submitted PO.'],
  ['All PO', 'Print', 'Print the purchase order note.'],
  ['All PO', 'Excel export', 'Export the selected purchase orders, or all of them.'],
  ['All PO', 'Delete', 'Delete a PO that is submitted to the vendor or in transit.'],
  ['Draft POs', 'Save', 'Save a purchase order as a draft at /store/purchase-orders/drafts.'],
  ['Draft POs', 'Edit', 'Edit a draft before the supplier sees it.'],
  ['Draft POs', 'Submit', 'Submit a draft from the drafts list.'],
  ['PO received', 'Goods received', 'Record received lots, rolls, and metres at /store/po-received.'],
  ['PO received', 'Process barcodes', 'Create one barcode per received roll and open the process page.'],
  ['PO received', 'Print roll barcodes', 'Print roll stickers from the process page.'],
  ['PO received', 'A4 barcode preview', 'Preview the same roll barcodes on A4 before printing.'],
  ['Inward entries', 'Record against PO', 'Inward entry that creates the lots and rolls before QC and storage.'],
  ['PO return', 'Scan rejected rolls', 'Scan QC-rejected rolls at /store/vendor-returns.'],
  ['PO return', 'Raise return', 'Send the scanned lot back to the supplier.'],
  ['PO return challan', 'Search and open', 'Find and open a return challan at /store/return-challans.'],
  ['PO return challan', 'Print', 'Reprint the challan raised from a PO return.'],
  ['PO return challan', 'Template review', 'Cross-check the purchase return challan format before it is treated as final.'],
  ['GRN', 'History and date range', 'GRN history at /store/grn, with search and a date range.'],
  ['GRN', 'Monthly summary', 'Monthly GRN summary on the same screen.'],
  ['GRN', 'Reprint', 'Open a receipt and reprint the GRN.'],
  ['GRN', 'Template review', 'Cross-check the GRN format before it is treated as final.'],
  ['Fabric QC', 'Pending queue', 'Pending fabric QC queue at /quality/fabric.'],
  ['Fabric QC', 'Scan rolls', 'Scan the rolls in a received lot.'],
  ['Fabric QC', 'Pass reject or hold', 'Pass, reject, or hold a received lot.'],
  ['Fabric QC', 'QC history', 'QC history for a lot after the decision.'],
  ['Requisition', 'Required fabric list', 'List fabric that is short of the quantity the floor needs.'],
  ['Requisition', 'MOQ 2000 metres', 'Each fabric uses a minimum order quantity of 2000 metres when the requisition is built.'],
  ['Requisition', 'Raise draft PO', 'Turn a requisition line into a draft purchase order.'],
  ['Opening stock', 'Upload existing fabric', 'Upload the fabric already in the Jaipur store so live inventory starts from that stock.'],
  ['Opening stock', 'Upload PO list till date', 'Upload the purchase orders raised till date. Later POs come in as a separate list.'],
  ['Fabric issue', 'Order and article', 'Pick an open production order and article at /store/issue.'],
  ['Fabric issue', 'Fabric requirement', 'Show the metres the order still needs against the BOM.'],
  ['Fabric issue', 'Issue roll', 'Scan one stored roll against one fabric line.'],
  ['Fabric issue', 'Issue log', 'Open the log of rolls already issued.'],
  ['Fabric return', 'Scan roll onto rack', 'Scan an issued roll back onto a rack at /store/fabric-return.'],
  ['Fabric storage', 'Unallocated rolls', 'QC-passed rolls that are not on a rack yet, at /store/racks.'],
  ['Fabric storage', 'Allocated rolls', 'Rolls that already sit on a rack.'],
  ['Fabric storage', 'Rack layout', 'Rack layout for stored rolls.'],
  ['Fabric storage', 'Roll tracker', 'Track a roll after it is stored.'],
  ['Fabric storage', 'Shelf barcode stickers', 'Print a barcode sticker for each shelf that holds fabric.'],
  ['Barcode template', 'Review', 'Cross-check the roll barcode sticker format before it is treated as final.'],
  ['Store notifications', 'Who is nudged when', 'Store nudges for goods received, QC hold or reject, stock under the 2000 metre MOQ, and a return raised.'],
  ['Live inventory', 'Rolls on racks', 'Live inventory at /store/reports/live-inventory: rolls on racks and the stored roll count.'],
  ['Fabric stock report', 'Rolls by status', 'Stock report at /store/reports/stock: received, stored, held, issued, on floor, and returned.'],
  ['Purchase report', 'PO by status', 'Purchase report at /store/reports/po, from draft through received.'],
  ['Return report', 'Returns by supplier', 'Purchase return report: challans and metres sent back, by supplier and date.'],
  ['Fabric analytics', 'QC and receipts', 'Fabric analytics at /store/reports/fabric: QC pending, passed, held, receipts, and returns.'],
  ['Consumption report', 'Metres issued vs BOM', 'Metres issued to orders against the BOM, by fabric, order, and date.'],
  ['Suppliers report', 'QC checks', 'Receipts, passed, rejected, and held lots per fabric supplier.'],
  ['Replenishment', 'Recommendation', 'Suggest a reorder when stock is under the 2000 metre MOQ.'],
  ['WIP by sort', 'Current sort on floor', 'Current work in progress by fabric sort number.'],
];

const CHECKPOINTS = FEATURES.map(([screen, feature, detail]) => row(screen, feature, detail));

/**
 * Connects with MONGODB_URL from the backend .env.
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
 * Creates the Fabric Management module when it is missing.
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
 * Drops unsigned screen-level fabric rows so the feature rows replace them.
 * @param {import('mongoose').Document} moduleDoc
 * @returns {Promise<{ removed: string[], kept: string[] }>}
 */
const removeLegacy = async (moduleDoc) => {
  const removed = [];
  const kept = [];
  for (const title of LEGACY_TITLES) {
    const existing = await CheckpointItem.findOne({ moduleId: moduleDoc._id, title });
    if (!existing) continue;
    if (!(await isUnusedLegacy(existing))) {
      kept.push(title);
      continue;
    }
    await CheckpointLog.deleteMany({ itemId: existing._id });
    await existing.deleteOne();
    removed.push(title);
  }
  return { removed, kept };
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
 * Seeds Fabric Management feature rows. Safe to run again. A coarse screen row
 * is deleted only when it has no checks and no logs.
 */
const seedFabricCheckpoints = async () => {
  const safeUrl = await connect();
  const owner = await findOwner();
  const { doc, created: moduleCreated } = await ensureModule(owner);
  const { removed, kept } = await removeLegacy(doc);
  const { created, skipped } = await ensureItems(doc);

  console.log(`Database: ${safeUrl}`);
  console.log(`Module: ${MODULE_NAME} (${moduleCreated ? 'created' : 'already present'})`);
  console.log(`Removed unsigned screen rows ${removed.length}:`);
  removed.forEach((title) => console.log(`  - ${title}`));
  console.log(`Kept screen rows that already have a check or a log ${kept.length}:`);
  kept.forEach((title) => console.log(`  ! ${title}`));
  console.log(`Created ${created.length}:`);
  created.forEach((title) => console.log(`  + ${title}`));
  console.log(`Already present ${skipped.length}`);

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
