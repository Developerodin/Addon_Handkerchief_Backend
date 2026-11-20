/**
 * Removes every production order and floor data tied to those orders.
 * Store rolls are unchanged unless you pass --restore-issued-rolls.
 *
 * Development:
 *   NODE_ENV=development node --disable-warning=DEP0170 scripts/clear-production-orders.js --yes
 *
 * Production (dangerous):
 *   NODE_ENV=production node --disable-warning=DEP0170 scripts/clear-production-orders.js --yes --production
 */
import mongoose from 'mongoose';
import cfg from '../src/config/config.js';
import {
  CutPiece,
  FloorCompletion,
  PieceBundle,
  ProductionOrder,
  ProductionOrderLog,
  ThreadUse,
} from '../src/models/production.model.js';
import { FabricRoll, StockMovement } from '../src/models/store.model.js';
import { VersionPin } from '../src/models/versioning.model.js';
import { DispatchBox, DispatchShipment, PackingBundle } from '../src/models/warehouse.model.js';
import { QualityResult } from '../src/models/quality.model.js';

const ISSUED = new Set(['issued', 'on-floor']);

function silenceMongoUrlWarning() {
  const { emitWarning } = process;
  process.emitWarning = (warning, ...args) => {
    if (args[0] === 'DeprecationWarning' && args[1] === 'DEP0170') return undefined;
    if (typeof warning === 'object' && warning?.code === 'DEP0170') return undefined;
    return emitWarning.call(process, warning, ...args);
  };
}

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

function assertConfirmed(argv) {
  if (cfg.env !== 'development' && cfg.env !== 'production') {
    throw new Error(`Refusing to clear orders when NODE_ENV is ${cfg.env}.`);
  }
  if (!argv.includes('--yes')) {
    throw new Error('Refusing to clear. Pass --yes. On production also pass --production.');
  }
  if (cfg.env === 'production' && !argv.includes('--production')) {
    throw new Error('Refusing to clear production orders. Pass --yes --production.');
  }
}

/**
 * Puts issued rolls back on stock when their issue was only for a deleted order.
 * @param {import('mongoose').Types.ObjectId[]} orderIds
 */
async function restoreIssuedRolls(orderIds) {
  if (!orderIds.length) return 0;
  const issues = await StockMovement.find({
    kind: 'issue',
    entityType: 'roll',
    orderId: { $in: orderIds },
  })
    .select('entityId')
    .lean();
  const barcodes = [...new Set(issues.map((row) => row.entityId).filter(Boolean))];
  let restored = 0;
  for (const barcode of barcodes) {
    const roll = await FabricRoll.findOne({ $or: [{ barcode }, { rollCode: barcode }] });
    if (!roll || !ISSUED.has(roll.status)) continue;
    const later = await StockMovement.findOne({
      entityType: 'roll',
      entityId: barcode,
      kind: { $in: ['return-to-rack', 'receive'] },
      createdAt: { $gt: issues.find((row) => row.entityId === barcode)?.createdAt || new Date(0) },
    });
    if (later) continue;
    roll.status = 'stored';
    roll.currentGrossWeight = Number(roll.grossWeight) || Number(roll.currentGrossWeight) || 0;
    roll.currentNetWeight = Number(roll.netWeight) || Number(roll.currentNetWeight) || 0;
    roll.currentQtyMeters = Number(roll.qtyMeters) || Number(roll.currentQtyMeters) || 0;
    await roll.save();
    restored += 1;
  }
  return restored;
}

async function main() {
  silenceMongoUrlWarning();
  const argv = process.argv.slice(2);
  assertConfirmed(argv);
  const restoreRolls = argv.includes('--restore-issued-rolls');
  const target = describeTarget(cfg.mongoose.url);
  console.log(`Target ${cfg.env} database "${target.db}" on ${target.hosts}`);
  await mongoose.connect(cfg.mongoose.url, cfg.mongoose.options);
  try {
    const orders = await ProductionOrder.find().select('_id orderNumber lines.pinId').lean();
    const orderIds = orders.map((row) => row._id);
    const pinIds = [
      ...new Set(
        orders.flatMap((order) => (order.lines || []).map((line) => line.pinId).filter((id) => id && mongoose.Types.ObjectId.isValid(id)))
      ),
    ];
    console.log(`Found ${orders.length} production orders.`);
    if (orders.length) {
      console.log(orders.map((row) => row.orderNumber || row._id).join(', '));
    }

    const orderIdStrs = orderIds.map((id) => String(id));
    const packingBundles = await PackingBundle.deleteMany({ orderId: { $in: orderIds } });
    const dispatchShipments = await DispatchShipment.deleteMany(
      orderIds.length ? { productionOrderId: { $in: orderIds } } : {}
    );
    const dispatchBoxes = await DispatchBox.deleteMany(
      orderIds.length ? { productionOrderId: { $in: orderIds } } : {}
    );
    const quality = await QualityResult.deleteMany({
      $or: [{ orderId: { $in: orderIdStrs } }, { bundleId: { $regex: /^BD-/ } }],
    });
    const logs = await ProductionOrderLog.deleteMany({ orderId: { $in: orderIds } });
    const movements = await StockMovement.deleteMany({ orderId: { $in: orderIds } });
    const completions = await FloorCompletion.deleteMany({ orderId: { $in: orderIds } });
    const pieces = await CutPiece.deleteMany({ orderId: { $in: orderIds } });
    const bundles = await PieceBundle.deleteMany({ orderId: { $in: orderIds } });
    const thread = await ThreadUse.deleteMany({ orderId: { $in: orderIds } });
    const pins = pinIds.length ? await VersionPin.deleteMany({ _id: { $in: pinIds } }) : { deletedCount: 0 };
    const deleted = await ProductionOrder.deleteMany({});

    let rollsRestored = 0;
    if (restoreRolls) rollsRestored = await restoreIssuedRolls(orderIds);

    console.log(`Deleted orders: ${deleted.deletedCount}`);
    console.log(`Deleted logs: ${logs.deletedCount}, movements: ${movements.deletedCount}`);
    console.log(`Deleted floor completions: ${completions.deletedCount}, pieces: ${pieces.deletedCount}, bundles: ${bundles.deletedCount}`);
    console.log(`Deleted thread uses: ${thread.deletedCount}, version pins: ${pins.deletedCount}`);
    console.log(
      `Deleted packing bundles: ${packingBundles.deletedCount}, dispatch shipments: ${dispatchShipments.deletedCount}, dispatch boxes: ${dispatchBoxes.deletedCount}, quality rows: ${quality.deletedCount}`
    );
    if (restoreRolls) console.log(`Restored issued rolls to stored: ${rollsRestored}`);
    console.log(`Remaining orders: ${await ProductionOrder.countDocuments()}`);
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : 'Could not clear production orders';
  console.error(message);
  process.exitCode = 1;
});