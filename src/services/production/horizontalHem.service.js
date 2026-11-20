import httpStatus from 'http-status';
import ApiError from '../../utils/ApiError.js';
import { PieceBundle, ProductionOrder, ThreadUse } from '../../models/production.model.js';
import Machine from '../../models/machine.model.js';
import RawMaterial from '../../models/rawMaterial.model.js';
import { runTransaction, sessionOptions } from '../../utils/mongoTransaction.js';
import { QualityResult } from '../../models/quality.model.js';
import { logBundles, rackOfType } from './bundleFloor.js';
import { txnEntityUpdate } from './floorTxn.js';
import { completedBundlesFromLogs } from './floorCompleted.js';

const CREATED = { $or: [{ process: 'created' }, { process: '' }, { process: null }, { process: { $exists: false } }] };

/**
 * Bundle has not been horizontal hemmed yet.
 * @param {{ process?: string }} bundle
 */
const stillCreated = (bundle) => !bundle.process || bundle.process === 'created';

/**
 * Active bundles rack, matched by code or barcode.
 * @param {string} scanned
 */
const bundlesRack = (scanned) => rackOfType(scanned, 'bundles', 'This rack is not for bundles');

/**
 * Unique scanned bundle barcodes.
 * @param {string[] | undefined} barcodes
 */
const bundleCodes = (barcodes) => [...new Set((barcodes || []).map((code) => String(code || '').trim()).filter(Boolean))];

/**
 * Sewing-thread lines on the order line that owns this bundle.
 * @param {object | undefined} order
 * @param {string} lineId
 * @param {Map<string, string>} names
 */
const sewingThread = (order, lineId, names) => {
  const matched = (order?.lines || []).find((line) => lineId && String(line.id || line._id) === lineId);
  const line = matched || order?.lines?.[0];
  const rows = (line?.snapshot?.threadLines || []).filter((row) => row.materialRole === 'sewing-thread');
  const lines = rows.map((row) => ({
    name: names.get(String(row.rawMaterialId || '')) || 'Sewing thread',
    perPiece: Number(row.quantity) || 0,
  }));
  return { lines, perPiece: lines.reduce((sum, row) => sum + row.perPiece, 0) };
};

/**
 * Latest floor-check good qty per bundle (after M2/M4 split).
 * @param {string[]} bundleIds
 */
const latestFloorGoodByBundleIds = async (bundleIds) => {
  if (!bundleIds.length) return new Map();
  const rows = await QualityResult.find({
    kind: 'bundle-check',
    bundleId: { $in: bundleIds.map(String) },
  })
    .sort({ createdAt: -1 })
    .select('bundleId goodQty passGoodQty phase')
    .lean();
  const map = new Map();
  for (const row of rows) {
    const id = String(row.bundleId);
    if (!map.has(id)) {
      const pass = Number(row.passGoodQty) || 0;
      map.set(id, pass > 0 ? pass : Number(row.goodQty) || 0);
    }
  }
  return map;
};

/**
 * Pieces that continue after floor check (good only).
 * @param {object} row
 * @param {number} floorGood
 */
const hemWorkingQty = (row, floorGood) => {
  const finalGood = Number(row.finalGood) || 0;
  if (finalGood > 0) return finalGood;
  if (floorGood > 0) return floorGood;
  return Number(row.qty) || 0;
};

/**
 * @param {object} row
 * @param {Map<string, object>} orders
 * @param {Map<string, string>} names
 * @param {number} [workingQty]
 */
const shapeBundle = (row, orders, names, workingQty) => {
  const order = orders.get(String(row.orderId));
  const qty = workingQty != null ? workingQty : hemWorkingQty(row, 0);
  return {
    id: String(row.id || row._id),
    barcode: row.barcode || '',
    orderId: String(row.orderId),
    orderNumber: order?.orderNumber || '',
    qty,
    rackCode: row.rackCode || '',
    machineBarcode: row.machineBarcode || '',
    process: row.process || 'created',
    checkedGood: Boolean(row.checkedGood),
    sewingThread: sewingThread(order, row.lineId ? String(row.lineId) : '', names),
  };
};

/**
 * Orders and raw-material names for the bundles on screen.
 * @param {object[]} rows
 */
const orderContext = async (rows) => {
  const orderIds = [...new Set(rows.map((row) => String(row.orderId)))];
  const orders = await ProductionOrder.find({ _id: { $in: orderIds } })
    .select('orderNumber lines.id lines.snapshot.threadLines')
    .lean();
  const materialIds = [
    ...new Set(
      orders.flatMap((order) =>
        (order.lines || []).flatMap((line) =>
          (line.snapshot?.threadLines || [])
            .filter((thread) => thread.materialRole === 'sewing-thread' && thread.rawMaterialId)
            .map((thread) => String(thread.rawMaterialId))
        )
      )
    ),
  ];
  const materials = materialIds.length ? await RawMaterial.find({ _id: { $in: materialIds } }).select('name') : [];
  return {
    orders: new Map(orders.map((order) => [String(order._id || order.id), order])),
    names: new Map(materials.map((material) => [String(material.id || material._id), material.name || 'Sewing thread'])),
  };
};

/**
 * Good bundles on a rack, plus bundles already on a horizontal hem machine.
 */
export const upcomingHorizontalHem = async () => {
  const waitingQuery = { $and: [{ closed: true, checkedGood: true, rackCode: { $nin: ['', null] } }, CREATED] };
  const activeQuery = {
    $and: [{ closed: true, checkedGood: true, rackCode: { $in: ['', null] }, machineBarcode: { $nin: ['', null] } }, CREATED],
  };
  const [waiting, active] = await Promise.all([
    PieceBundle.find(waitingQuery).sort({ updatedAt: -1 }).limit(200).lean(),
    PieceBundle.find(activeQuery).sort({ updatedAt: -1 }).limit(200).lean(),
  ]);
  const bundleIds = [...waiting, ...active].map((row) => String(row._id || row.id));
  const floorGoodById = await latestFloorGoodByBundleIds(bundleIds);
  const syncOps = [];
  for (const row of [...waiting, ...active]) {
    const id = String(row._id || row.id);
    const work = hemWorkingQty(row, floorGoodById.get(id) || 0);
    if (!row.floorChecked || work < 1) continue;
    const stored = Number(row.qty) || 0;
    const storedFinal = Number(row.finalGood) || 0;
    if (work !== stored || storedFinal !== work) {
      syncOps.push(PieceBundle.updateOne({ _id: row._id }, { qty: work, finalGood: work }));
      row.qty = work;
      row.finalGood = work;
    }
  }
  if (syncOps.length) await Promise.all(syncOps);
  const { orders, names } = await orderContext([...waiting, ...active]);
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const [doneToday, onRack] = await Promise.all([
    PieceBundle.countDocuments({ process: 'horizontal-hem', updatedAt: { $gte: start } }),
    PieceBundle.countDocuments({ process: 'horizontal-hem', rackCode: { $nin: ['', null] } }),
  ]);
  const completed = await completedBundlesFromLogs(['horizontal-hem-done']);
  return {
    results: waiting.map((row) => {
      const id = String(row._id || row.id);
      return shapeBundle(row, orders, names, hemWorkingQty(row, floorGoodById.get(id) || 0));
    }),
    active: active.map((row) => {
      const id = String(row._id || row.id);
      return shapeBundle(row, orders, names, hemWorkingQty(row, floorGoodById.get(id) || 0));
    }),
    completed,
    counts: { waiting: waiting.length, onMachine: active.length, doneToday, onRack, completed: completed.length },
  };
};

/**
 * One order log when every bundle belongs to that order.
 * @param {object[]} bundles
 * @param {object} entry
 * @param {object | null} user
 */
/**
 * Rejects a bundle that is not a checked good bundle waiting on a rack.
 * @param {object} bundle
 * @param {string} rackCode
 */
const assertWaiting = (bundle, rackCode) => {
  if (bundle.process === 'horizontal-hem') throw new ApiError(httpStatus.BAD_REQUEST, 'This bundle is already hemmed');
  if (!bundle.checkedGood) throw new ApiError(httpStatus.BAD_REQUEST, 'Bundle checking has not marked this bundle good');
  if (!bundle.closed || !bundle.barcode) throw new ApiError(httpStatus.BAD_REQUEST, 'Close the bundle before hemming');
  if (!stillCreated(bundle)) throw new ApiError(httpStatus.BAD_REQUEST, 'This bundle is already hemmed');
  if (!bundle.rackCode && bundle.machineBarcode) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'This bundle is already on the machine');
  }
  if (!bundle.rackCode) throw new ApiError(httpStatus.BAD_REQUEST, 'This bundle is not on a rack');
  if (bundle.rackCode !== rackCode) throw new ApiError(httpStatus.BAD_REQUEST, 'This bundle is not on that rack');
};

/**
 * Picks checked bundles off a bundles rack onto a hemming machine.
 * @param {{ bundleBarcodes?: string[], rackCode?: string, machineBarcode?: string }} body
 * @param {object} [_params]
 * @param {object | null} [user]
 */
export const startHorizontalHem = async (body, _params, user) => {
  const codes = bundleCodes(body.bundleBarcodes);
  const rackCode = String(body.rackCode || '').trim();
  const machineBarcode = String(body.machineBarcode || '').trim();
  if (!codes.length) throw new ApiError(httpStatus.BAD_REQUEST, 'Bundle barcodes are required');
  if (!rackCode) throw new ApiError(httpStatus.BAD_REQUEST, 'Rack is required');
  if (!machineBarcode) throw new ApiError(httpStatus.BAD_REQUEST, 'Machine barcode is required');
  const machine = await Machine.findOne({ barcode: machineBarcode, status: 'active' });
  if (!machine) throw new ApiError(httpStatus.BAD_REQUEST, 'Machine not found');
  const rack = await bundlesRack(rackCode);
  const bundles = await PieceBundle.find({ barcode: { $in: codes } });
  if (bundles.length !== codes.length) throw new ApiError(httpStatus.BAD_REQUEST, 'Bundle not found');
  for (const bundle of bundles) assertWaiting(bundle, rack.code);
  return txnEntityUpdate({
    Model: PieceBundle,
    filter: { barcode: { $in: codes } },
    update: { rackCode: '', machineBarcode: machine.barcode, process: 'created' },
    afterUpdate: (session) =>
      logBundles(
        bundles,
        { action: 'horizontal-hem-start', fromLocation: rack.code, toLocation: machine.barcode, remarks: '' },
        user,
        session
      ),
    load: (session) => PieceBundle.find({ barcode: { $in: codes } }).session(session || undefined),
  });
};

/**
 * Thread quantity for the bundles on the machine. Zero is allowed.
 * @param {unknown} value
 */
const threadQuantity = (value) => {
  if (value == null || value === '') throw new ApiError(httpStatus.BAD_REQUEST, 'Thread quantity is required');
  const quantity = Number(value);
  if (Number.isNaN(quantity) || quantity < 0) throw new ApiError(httpStatus.BAD_REQUEST, 'Thread quantity is required');
  return quantity;
};

/**
 * Puts hemmed bundles back on a bundles rack and stores the sewing thread used.
 * @param {{ bundleBarcodes?: string[], rackCode?: string, threadQuantity?: number }} body
 * @param {object} [_params]
 * @param {object | null} [user]
 */
export const placeHorizontalHem = async (body, _params, user) => {
  const codes = bundleCodes(body.bundleBarcodes);
  const rackCode = String(body.rackCode || '').trim();
  const used = threadQuantity(body.threadQuantity);
  if (!codes.length) throw new ApiError(httpStatus.BAD_REQUEST, 'Bundle barcodes are required');
  if (!rackCode) throw new ApiError(httpStatus.BAD_REQUEST, 'Rack is required');
  const rack = await bundlesRack(rackCode);
  const bundles = await PieceBundle.find({ barcode: { $in: codes } });
  if (bundles.length !== codes.length) throw new ApiError(httpStatus.BAD_REQUEST, 'Bundle not found');
  for (const bundle of bundles) {
    if (bundle.process === 'horizontal-hem') throw new ApiError(httpStatus.BAD_REQUEST, 'This bundle is already hemmed');
    if (!bundle.checkedGood) throw new ApiError(httpStatus.BAD_REQUEST, 'Bundle checking has not marked this bundle good');
    if (!bundle.closed || !bundle.barcode) throw new ApiError(httpStatus.BAD_REQUEST, 'Close the bundle before hemming');
    if (!bundle.machineBarcode || bundle.rackCode) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'This bundle is not on the machine');
    }
  }
  const orderIds = [...new Set(bundles.map((bundle) => String(bundle.orderId)))];
  return runTransaction(async (session) => {
    await ThreadUse.create(
      orderIds.map((orderId) => ({
        orderId,
        machineBarcode: bundles.find((bundle) => String(bundle.orderId) === orderId)?.machineBarcode || '',
        materialRole: 'sewing-thread',
        quantity: used,
      })),
      sessionOptions(session)
    );
    await PieceBundle.updateMany(
      { barcode: { $in: codes } },
      { process: 'horizontal-hem', rackCode: rack.code },
      sessionOptions(session)
    );
    await logBundles(bundles, { action: 'horizontal-hem-done', fromLocation: '', toLocation: rack.code, remarks: '' }, user, session);
    return PieceBundle.find({ barcode: { $in: codes } }).session(session || undefined);
  });
};
