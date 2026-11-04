import mongoose from 'mongoose';
import dotenv from 'dotenv';
import User from '../src/models/user.model.js';
import { CheckpointItem, CheckpointModule } from '../src/models/checkpoint.model.js';

dotenv.config();

const MODULE_NAME = 'Production';

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
  ['Orders', 'Save draft', 'Create a production order as a draft at /production/orders/add. One row per article, with order number, buyer, and priority.'],
  ['Orders', 'Edit', 'Edit a draft, or save changes on a released order, at /production/orders/[id]/edit.'],
  ['Orders', 'Delete draft', 'Delete a draft that has not been released.'],
  ['Orders', 'Release', 'Release pins the published revision. The preview shows the lines before the order leaves draft.'],
  ['Orders', 'View', 'Open an order: lines, pinned fabric, floors, and segments.'],
  ['Orders', 'Logs', 'Open who did what on the order.'],
  ['Orders', 'Hold and resume', 'Put a released or in-progress order on hold, then take it off hold.'],
  ['Orders', 'Amend revision', 'Move unfinished quantity on a line onto a different published revision.'],
  ['Orders', 'Treat fabric as issued', 'On a released or in-progress order, treat fabric as issued and get a roll barcode.'],
  ['Orders', 'Return fabric', 'From an order that already has issued rolls, open fabric return for that order.'],
  ['Orders', 'List and filters', 'Tiles for in progress, completed, pending, and on hold. Search, status, priority, and sort at /production/orders.'],
  ['Orders', 'Article view', 'Article view tab: one row per article line across orders.'],
  ['Orders', 'Fabric estimation', 'Fabric estimation tab: metres the open orders still need.'],
  ['Orders', 'Upcoming floors', 'Upcoming view: which floor each open order is heading to.'],
  ['Vertical cutting', 'Upcoming rolls', 'Issued rolls waiting to be cut at /production/floor/vertical-cutting.'],
  ['Vertical cutting', 'Scan roll', 'Open a job by scanning the roll barcode or roll code. The roll must be issued to an open order.'],
  ['Vertical cutting', 'Cut', 'Cut the roll into the planned piece count. Each piece gets its own barcode.'],
  ['Vertical cutting', 'Print labels', 'Print the piece barcode labels from the cut job.'],
  ['Vertical cutting', 'Place on rack', 'Place one scanned piece, or every piece from the cut, onto a pieces rack.'],
  ['Selvage cutting', 'Upcoming pieces', 'Pieces waiting on a rack at /production/floor/selvage-cutting.'],
  ['Selvage cutting', 'Scan piece', 'Open a job by scanning the piece barcode.'],
  ['Selvage cutting', 'Start', 'Take the piece off the rack and start selvage. Another piece on the same rack can be added.'],
  ['Selvage cutting', 'Place on rack', 'Put the same piece barcodes back on a pieces rack.'],
  ['Half moon cutting', 'Upcoming pieces', 'Selvage pieces waiting on a rack at /production/floor/half-moon.'],
  ['Half moon cutting', 'Scan piece', 'Open a job by scanning the piece barcode.'],
  ['Half moon cutting', 'Start', 'Start half moon on the racked pieces.'],
  ['Half moon cutting', 'Place on rack', 'Put the same piece barcodes back on a pieces rack.'],
  ['Vertical hemming', 'Upcoming pieces', 'Half-moon pieces waiting on a rack at /production/floor/vertical-hem.'],
  ['Vertical hemming', 'Scan piece', 'Open a job by scanning the piece barcode.'],
  ['Vertical hemming', 'Start', 'Move the pieces from the rack onto the hemming machine.'],
  ['Vertical hemming', 'Sewing thread', 'Record the sewing thread used. The expected quantity is the per-piece thread times the piece count.'],
  ['Vertical hemming', 'Place on rack', 'Put the hemmed pieces back on a pieces rack.'],
  ['Single piece cutting', 'Upcoming pieces', 'Hemmed pieces waiting to be cut at /production/floor/bundle.'],
  ['Single piece cutting', 'Scan piece', 'Open a job by scanning the piece barcode.'],
  ['Single piece cutting', 'Start', 'Start the pieces on the cutting table.'],
  ['Single piece cutting', 'Cut', 'Cut the table pieces. A full bundle is 60 and comes back with a barcode. Good and M4 counts are recorded.'],
  ['Single piece cutting', 'Close bundle', 'Close the open bundle at the counted quantity before it can go on a rack.'],
  ['Single piece cutting', 'Print label', 'Print the bundle barcode label.'],
  ['Single piece cutting', 'Place on rack', 'Put the closed bundle on a bundles rack.'],
  ['Floor checks', 'Upcoming bundles', 'Bundles on a rack waiting for a floor check at /quality/floor.'],
  ['Floor checks', 'Bundle check', 'Save good, defect, and M4 quantities for one bundle.'],
  ['Floor checks', 'Final good quantity', 'Save the final good quantity against the order.'],
  ['Floor checks', 'Reject roll', 'Send a rejected roll back onto a rack.'],
  ['Horizontal hemming', 'Upcoming bundles', 'Checked bundles waiting at /production/floor/horizontal-hem.'],
  ['Horizontal hemming', 'Scan bundle', 'Open a job by scanning the bundle barcode.'],
  ['Horizontal hemming', 'Start', 'Start the bundle on a hemming machine. Another waiting bundle can be added.'],
  ['Horizontal hemming', 'Sewing thread', 'Record the sewing thread used on the hem.'],
  ['Horizontal hemming', 'Place on rack', 'Put the hemmed bundle on a bundles rack.'],
  ['Thread cutting', 'Upcoming bundles', 'Hemmed bundles waiting at /production/floor/thread-cut.'],
  ['Thread cutting', 'Scan bundle', 'Open a job by scanning the bundle barcode.'],
  ['Thread cutting', 'Start', 'Start the bundles on a thread-cutting table. No thread quantity is stored.'],
  ['Thread cutting', 'Place on rack', 'Put the bundles back on a bundles rack.'],
  ['Final QC', 'Upcoming bundles', 'Bundles waiting for final QC at /quality/final-qc.'],
  ['Final QC', 'Scan bundle', 'Open a bundle by scanning its barcode.'],
  ['Final QC', 'Grade counts', 'Save good, long, hemming, sporting, diving, and rejection. The counts must sum to the bundle quantity.'],
  ['Final QC', 'Grade racks', 'Each grade can go to its own rack.'],
  ['Move to ground', 'Upcoming bundles', 'Good bundles waiting on a rack at /production/floor/to-ground.'],
  ['Move to ground', 'Scan bundle', 'Open a bundle that is ready for the ground floor.'],
  ['Move to ground', 'Place in container', 'Put the bundle into a bundle container. No machine start.'],
  ['Ironing', 'Upcoming bundles', 'Bundles already in a container, at /production/floor/iron.'],
  ['Ironing', 'Scan bundle', 'Open a bundle that is in a container for ironing.'],
  ['Ironing', 'Start', 'Start the bundle on an iron.'],
  ['Ironing', 'Place on rack', 'Put the ironed bundle on a bundles rack.'],
  ['Route split', 'Upcoming bundles', 'Ironed bundles waiting on a rack at /production/floor/route-split.'],
  ['Route split', 'Scan bundle', 'Open an ironed bundle.'],
  ['Route split', 'Break', 'Break the bundle. The piece count must match final QC, and the order picks embroidery or sticker.'],
  ['Embroidery', 'Upcoming bundles', 'Broken bundles on the embroidery route, at /production/floor/embroidery.'],
  ['Embroidery', 'Scan bundle', 'Open a bundle that is for embroidery.'],
  ['Embroidery', 'Start', 'Take the bundle off its rack and start it on a machine.'],
  ['Embroidery', 'Thread quantity', 'Record the embroidery thread used. The quantity is typed, not looked up from a catalog line.'],
  ['Embroidery', 'Place on rack', 'Put the embroidered bundle on a bundles rack.'],
  ['Thread cutting after embroidery', 'Upcoming bundles', 'Embroidered bundles waiting at /production/floor/embroidery-thread-cut.'],
  ['Thread cutting after embroidery', 'Scan bundle', 'Open a bundle that has been embroidered.'],
  ['Thread cutting after embroidery', 'Start', 'Start the bundle on a table. No thread quantity is stored.'],
  ['Thread cutting after embroidery', 'Place on rack', 'Put the bundle back on a bundles rack.'],
  ['Sticker', 'Upcoming bundles', 'Broken bundles on the sticker route, at /production/floor/sticker.'],
  ['Sticker', 'Scan bundle', 'Open a bundle that is for sticker.'],
  ['Sticker', 'Start', 'Take the bundle off its rack and start it on a table. No thread is recorded.'],
  ['Sticker', 'Place on rack', 'Put the stickered bundle on a bundles rack.'],
  ['Ironing after route', 'Upcoming bundles', 'Bundles waiting for the second iron, after embroidery thread cutting or after sticker, at /production/floor/iron-after.'],
  ['Ironing after route', 'Scan bundle', 'Open a bundle that is ready for the second iron.'],
  ['Ironing after route', 'Start', 'Start the bundle on an iron.'],
  ['Ironing after route', 'Place on rack', 'Put the bundle on a bundles rack.'],
  ['Final checking', 'Upcoming bundles', 'Bundles waiting for final checking at /quality/final-checking.'],
  ['Final checking', 'Scan bundle', 'Open a bundle by scanning its barcode.'],
  ['Final checking', 'Good and defect', 'Good and defect must sum to the final-good quantity from final QC.'],
  ['Final checking', 'Packing rack', 'Put the checked bundle on a packing rack.'],
];

const CHECKPOINTS = FEATURES.map(([screen, feature, detail]) => row(screen, feature, detail));

/**
 * First argument wins. Otherwise MONGODB_URL from the shell, then .env.
 * @returns {string}
 */
const mongoUrl = () => {
  const fromArg = process.argv[2];
  if (fromArg && !fromArg.startsWith('-')) return fromArg;
  return process.env.MONGODB_URL || '';
};

/**
 * The path after the host is the database. A URL with no path lands on admin and fails.
 * @param {string} url
 */
const assertDatabase = (url) => {
  const queryIndex = url.indexOf('?');
  const base = queryIndex === -1 ? url : url.slice(0, queryIndex);
  const slash = base.lastIndexOf('/');
  const hasDb = slash > base.indexOf('://') + 2 && slash < base.length - 1;
  if (!hasDb) {
    throw new Error('Mongo URL must include the database name: mongodb+srv://user:pass@host/DATABASE?retryWrites=true&w=majority');
  }
};

/**
 * Connects with the URL passed on the command, or MONGODB_URL.
 * @returns {Promise<string>}
 */
const connect = async () => {
  const url = mongoUrl();
  if (!url) {
    throw new Error('Pass the Mongo URL: node scripts/seedProductionCheckpoints.js "mongodb+srv://..."');
  }
  assertDatabase(url);
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
 * Creates the Production module when it is missing.
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
 * Sort order that sits the new row directly under the previous feature.
 * Rows already below that neighbor move down by one. Missing neighbor appends at the end.
 * @param {import('mongoose').Document} moduleDoc
 * @param {number} featureIndex
 * @returns {Promise<number>}
 */
const sortOrderAfterNeighbor = async (moduleDoc, featureIndex) => {
  const previous = featureIndex > 0 ? CHECKPOINTS[featureIndex - 1] : null;
  if (previous) {
    const neighbor = await CheckpointItem.findOne({ moduleId: moduleDoc._id, title: previous.title }).select('sortOrder').lean();
    if (neighbor) {
      await CheckpointItem.updateMany(
        { moduleId: moduleDoc._id, sortOrder: { $gt: neighbor.sortOrder } },
        { $inc: { sortOrder: 1 } }
      );
      return neighbor.sortOrder + 1;
    }
  }
  const last = await CheckpointItem.findOne({ moduleId: moduleDoc._id }).sort({ sortOrder: -1 }).select('sortOrder').lean();
  return (last?.sortOrder ?? 0) + 1;
};

/**
 * Inserts missing feature rows. Existing titles keep their checks.
 * @param {import('mongoose').Document} moduleDoc
 * @returns {Promise<{ created: string[], skipped: string[] }>}
 */
const ensureItems = async (moduleDoc) => {
  const created = [];
  const skipped = [];

  for (let index = 0; index < CHECKPOINTS.length; index += 1) {
    const checkpoint = CHECKPOINTS[index];
    const existing = await CheckpointItem.findOne({ moduleId: moduleDoc._id, title: checkpoint.title });
    if (existing) {
      skipped.push(checkpoint.title);
      continue;
    }
    const sortOrder = await sortOrderAfterNeighbor(moduleDoc, index);
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
 * Seeds Production feature rows. Safe to run again: existing titles keep their checks.
 */
const seedProductionCheckpoints = async () => {
  const safeUrl = await connect();
  const owner = await findOwner();
  const { doc, created: moduleCreated } = await ensureModule(owner);
  const { created, skipped } = await ensureItems(doc);

  console.log(`Database: ${safeUrl}`);
  console.log(`Module: ${MODULE_NAME} (${moduleCreated ? 'created' : 'already present'})`);
  console.log(`Created ${created.length}:`);
  created.forEach((title) => console.log(`  + ${title}`));
  console.log(`Already present ${skipped.length}`);

  await mongoose.disconnect();
};

seedProductionCheckpoints().catch(async (err) => {
  console.error(err instanceof Error ? err.message : err);
  try {
    await mongoose.disconnect();
  } catch (disconnectErr) {
    console.error(disconnectErr instanceof Error ? disconnectErr.message : disconnectErr);
  }
  process.exit(1);
});
