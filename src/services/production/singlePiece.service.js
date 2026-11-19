import httpStatus from 'http-status';
import ApiError from '../../utils/ApiError.js';
import { CutPiece, PieceBundle, ProductionOrder } from '../../models/production.model.js';
import Machine from '../../models/machine.model.js';
import { nextCode } from '../factory/ids.js';
import { rackOfType } from './bundleFloor.js';
import { writeOrderLog } from '../orderLog.service.js';
import { runTransaction, sessionOptions } from '../../utils/mongoTransaction.js';
import { completedBundlesFromLogs } from './floorCompleted.js';

const BUNDLE_SIZE = 60;

/**
 * Active rack of one stock type, matched by code or barcode.
 * @param {string} scanned
 * @param {string} stockType
 * @param {string} wrongType
 */
const rackOf = (scanned, stockType, wrongType) => rackOfType(scanned, stockType, wrongType);

/**
 * Unique scanned piece barcodes.
 * @param {string[] | undefined} barcodes
 */
const pieceCodes = (barcodes) => [...new Set((barcodes || []).map((code) => String(code || '').trim()).filter(Boolean))];

/**
 * Non-negative whole number.
 * @param {unknown} value
 * @param {string} name
 */
const wholeCount = (value, name) => {
  const count = Number(value);
  if (!Number.isInteger(count) || count < 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, `${name} must be a whole number`);
  }
  return count;
};

/**
 * @param {object} bundle
 * @param {Map<string, string>} orderNumbers
 */
const shapeBundle = (bundle, orderNumbers) => ({
  id: String(bundle.id || bundle._id),
  barcode: bundle.barcode || '',
  orderId: String(bundle.orderId),
  orderNumber: orderNumbers.get(String(bundle.orderId)) || '',
  number: bundle.number,
  qty: bundle.qty,
  m4Qty: bundle.m4Qty || 0,
  closed: Boolean(bundle.closed),
  rackCode: bundle.rackCode || '',
  checkedGood: Boolean(bundle.checkedGood),
  status: bundle.status || (bundle.closed ? 'closed' : 'open'),
});

/**
 * @param {object} row
 * @param {Map<string, string>} orderNumbers
 */
const shapePiece = (row, orderNumbers) => ({
  barcode: row.barcode,
  orderId: String(row.orderId),
  orderNumber: orderNumbers.get(String(row.orderId)) || '',
  rollBarcode: row.rollBarcode || '',
  rackCode: row.rackCode || '',
  machineBarcode: row.machineBarcode || '',
  status: row.status,
  goodQty: row.goodQty || 0,
  m4Qty: row.m4Qty || 0,
});

/**
 * @param {string[]} orderIds
 */
const orderNumbersFor = async (orderIds) => {
  const orders = await ProductionOrder.find({ _id: { $in: orderIds } }).select('orderNumber');
  return new Map(orders.map((order) => [String(order.id), order.orderNumber || '']));
};

/**
 * Hemmed pieces on a rack, pieces on the table, and the open or unplaced bundles.
 */
export const upcomingSinglePiece = async () => {
  const waitingQuery = { status: 'on-rack', process: 'vertical-hem' };
  const activeQuery = { status: 'in-work', process: 'vertical-hem' };
  const [waiting, active, openBundles, ready] = await Promise.all([
    CutPiece.find(waitingQuery).sort({ updatedAt: -1 }).limit(200).lean(),
    CutPiece.find(activeQuery).sort({ updatedAt: -1 }).limit(200).lean(),
    PieceBundle.find({ closed: false, qty: { $gt: 0 } }).sort({ updatedAt: -1 }).limit(50),
    PieceBundle.find({ closed: true, barcode: { $ne: '' }, rackCode: '' }).sort({ updatedAt: -1 }).limit(50),
  ]);
  const orderIds = [
    ...new Set([...waiting, ...active, ...openBundles, ...ready].map((row) => String(row.orderId))),
  ];
  const orderNumbers = await orderNumbersFor(orderIds);
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const closedToday = await PieceBundle.countDocuments({ closed: true, barcode: { $ne: '' }, updatedAt: { $gte: start } });
  // Completed = closed bundles placed on a rack (next floor). Piece-cut logs are intermediate, not transfers.
  const completed = await completedBundlesFromLogs(['bundle-place']);
  return {
    results: waiting.map((row) => shapePiece(row, orderNumbers)),
    active: active.map((row) => shapePiece(row, orderNumbers)),
    openBundles: openBundles.map((row) => shapeBundle(row, orderNumbers)),
    ready: ready.map((row) => shapeBundle(row, orderNumbers)),
    completed,
    counts: {
      waiting: waiting.length,
      onTable: active.length,
      openQty: openBundles.reduce((sum, row) => sum + (row.qty || 0), 0),
      closedToday,
      completed: completed.length,
    },
  };
};

/**
 * One order log when every row belongs to that order.
 * @param {object[]} rows
 * @param {object} entry
 * @param {object | null} user
 */
const logRows = (rows, entry, user, session = null) => {
  const orderIds = new Set(rows.map((row) => String(row.orderId)));
  return writeOrderLog(
    {
      ...entry,
      orderId: orderIds.size === 1 ? rows[0].orderId : undefined,
      quantity: entry.quantity || rows.length,
    },
    user,
    session
  );
};

/**
 * Picks racked hemmed pieces onto the single-piece table.
 * @param {{ pieceBarcodes?: string[], rackCode?: string, machineBarcode?: string }} body
 * @param {object} [_params]
 * @param {object | null} [user]
 */
export const startSinglePiece = async (body, _params, user) => {
  const codes = pieceCodes(body.pieceBarcodes);
  const rackCode = String(body.rackCode || '').trim();
  const machineBarcode = String(body.machineBarcode || '').trim();
  if (!codes.length) throw new ApiError(httpStatus.BAD_REQUEST, 'Piece barcodes are required');
  if (!rackCode) throw new ApiError(httpStatus.BAD_REQUEST, 'Rack is required');
  if (!machineBarcode) throw new ApiError(httpStatus.BAD_REQUEST, 'Machine barcode is required');
  const machine = await Machine.findOne({ barcode: machineBarcode, status: 'active' });
  if (!machine) throw new ApiError(httpStatus.BAD_REQUEST, 'Machine not found');
  const rack = await rackOf(rackCode, 'pieces', 'This rack is not for pieces');
  const pieces = await CutPiece.find({ barcode: { $in: codes } });
  if (pieces.length !== codes.length) throw new ApiError(httpStatus.BAD_REQUEST, 'Piece not found');
  for (const piece of pieces) {
    if (piece.status === 'bundled') throw new ApiError(httpStatus.BAD_REQUEST, 'This piece is already cut into a bundle');
    if (piece.status === 'cut' || !piece.rackCode) throw new ApiError(httpStatus.BAD_REQUEST, 'This piece is not on a rack');
    if (piece.status !== 'on-rack') throw new ApiError(httpStatus.BAD_REQUEST, 'This piece is already on the table');
    if (piece.process !== 'vertical-hem') throw new ApiError(httpStatus.BAD_REQUEST, 'This piece is not hemmed');
    if (piece.rackCode !== rack.code) throw new ApiError(httpStatus.BAD_REQUEST, 'This piece is not on that rack');
  }
  return runTransaction(async (session) => {
    await CutPiece.updateMany(
      { barcode: { $in: codes } },
      { status: 'in-work', machineBarcode: machine.barcode },
      sessionOptions(session)
    );
    await logRows(
      pieces,
      { action: 'single-piece-start', entityType: 'roll', entityCode: pieces[0].barcode, fromLocation: rack.code, toLocation: machine.barcode, remarks: '' },
      user,
      session
    );
    return CutPiece.find({ barcode: { $in: codes } }).session(session || undefined);
  });
};

/**
 * Open bundle for an order, created empty when none exists.
 * @param {string} orderId
 */
const ensureOpen = async (orderId, session = null) => {
  let openQuery = PieceBundle.findOne({ orderId, closed: false }).sort({ number: -1 });
  if (session) openQuery = openQuery.session(session);
  const open = await openQuery;
  if (open) return open;
  let lastQuery = PieceBundle.findOne({ orderId }).sort({ number: -1 });
  if (session) lastQuery = lastQuery.session(session);
  const last = await lastQuery;
  const [created] = await PieceBundle.create(
    [{ orderId, number: (last?.number || 0) + 1, qty: 0, closed: false, status: 'open' }],
    sessionOptions(session)
  );
  return created;
};

/**
 * Marks a full bundle closed and gives it a barcode.
 * @param {object} bundle
 */
const sealBundle = async (bundle, session = null) => {
  bundle.closed = true;
  bundle.status = 'closed';
  bundle.barcode = nextCode('BD');
  await bundle.save(sessionOptions(session));
  return bundle;
};

/**
 * Adds good handkerchiefs to the order's open bundle, closing every full 60.
 * A remainder stays open without a barcode. An exact 60 does not leave an empty bundle.
 * @param {string} orderId
 * @param {number} goodQty
 */
const pourGood = async (orderId, goodQty, session = null) => {
  const closed = [];
  if (goodQty <= 0) {
    let openQuery = PieceBundle.findOne({ orderId, closed: false }).sort({ number: -1 });
    if (session) openQuery = openQuery.session(session);
    const open = await openQuery;
    return { closed, open, last: open };
  }
  let bundle = await ensureOpen(orderId, session);
  let left = goodQty;
  while (left > 0) {
    const room = BUNDLE_SIZE - bundle.qty;
    if (room <= 0) {
      await sealBundle(bundle, session);
      closed.push(bundle);
      const [next] = await PieceBundle.create(
        [{ orderId: bundle.orderId, number: bundle.number + 1, qty: 0, closed: false, status: 'open' }],
        sessionOptions(session)
      );
      bundle = next;
    }
    const take = Math.min(BUNDLE_SIZE - bundle.qty, left);
    bundle.qty += take;
    left -= take;
    if (bundle.qty >= BUNDLE_SIZE) {
      await sealBundle(bundle, session);
      closed.push(bundle);
      if (left > 0) {
        const [next] = await PieceBundle.create(
          [{ orderId: bundle.orderId, number: bundle.number + 1, qty: 0, closed: false, status: 'open' }],
          sessionOptions(session)
        );
        bundle = next;
      }
    } else {
      await bundle.save(sessionOptions(session));
    }
  }
  const open = bundle.closed ? null : bundle;
  return { closed, open, last: open || closed[closed.length - 1] };
};

/**
 * Cuts table pieces into handkerchiefs and fills bundles of 60. M4 stays off the bundle.
 * @param {{ pieces?: { barcode?: string, goodQty?: number, m4Qty?: number }[] }} body
 * @param {object} [_params]
 * @param {object | null} [user]
 */
export const cutSinglePiece = async (body, _params, user) => {
  const rows = Array.isArray(body.pieces) ? body.pieces : [];
  if (!rows.length) throw new ApiError(httpStatus.BAD_REQUEST, 'Piece counts are required');
  const counts = rows.map((row) => ({
    barcode: String(row.barcode || '').trim(),
    goodQty: wholeCount(row.goodQty, 'Good quantity'),
    m4Qty: wholeCount(row.m4Qty, 'M4 quantity'),
  }));
  if (counts.some((row) => !row.barcode)) throw new ApiError(httpStatus.BAD_REQUEST, 'Piece barcodes are required');
  if (counts.some((row) => row.goodQty === 0 && row.m4Qty === 0)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Count is required');
  }
  const pieces = await CutPiece.find({ barcode: { $in: counts.map((row) => row.barcode) } });
  if (pieces.length !== counts.length) throw new ApiError(httpStatus.BAD_REQUEST, 'Piece not found');
  const byBarcode = new Map(pieces.map((piece) => [piece.barcode, piece]));
  for (const row of counts) {
    const piece = byBarcode.get(row.barcode);
    if (piece.status === 'bundled') throw new ApiError(httpStatus.BAD_REQUEST, 'This piece is already cut into a bundle');
    if (piece.status !== 'in-work' || piece.process !== 'vertical-hem') {
      throw new ApiError(httpStatus.BAD_REQUEST, 'This piece is not on the table');
    }
  }
  return runTransaction(async (session) => {
    const closed = [];
    const open = [];
    for (const row of counts) {
      const piece = byBarcode.get(row.barcode);
      const poured = await pourGood(String(piece.orderId), row.goodQty, session);
      closed.push(...poured.closed);
      if (poured.open) open.push(poured.open);
      const attach = poured.closed.length ? poured.closed[poured.closed.length - 1] : poured.open;
      if (attach && row.m4Qty > 0) {
        attach.m4Qty = (Number(attach.m4Qty) || 0) + row.m4Qty;
        await attach.save(sessionOptions(session));
      }
      piece.status = 'bundled';
      piece.goodQty = row.goodQty;
      piece.m4Qty = row.m4Qty;
      piece.bundleId = attach?._id || attach?.id || poured.last?.id || piece.bundleId;
      await piece.save(sessionOptions(session));
    }
    await logRows(
      pieces,
      {
        action: 'single-piece-cut',
        entityType: 'roll',
        entityCode: pieces[0].barcode,
        quantity: counts.reduce((sum, row) => sum + row.goodQty, 0),
        fromLocation: '',
        toLocation: '',
        remarks: `m4 ${counts.reduce((sum, row) => sum + row.m4Qty, 0)}`,
      },
      user,
      session
    );
    const orderNumbers = await orderNumbersFor([...new Set(pieces.map((piece) => String(piece.orderId)))]);
    return {
      pieces: pieces.map((piece) => shapePiece(piece, orderNumbers)),
      closed: closed.map((bundle) => shapeBundle(bundle, orderNumbers)),
      open: open.map((bundle) => shapeBundle(bundle, orderNumbers)),
    };
  });
};

/**
 * Closes the order's open bundle at the counted quantity.
 * @param {{ orderId?: string }} body
 * @param {object} [_params]
 * @param {object | null} [user]
 */
/**
 * Moves good qty from the order open bundle into M4 (not reusable for 60-bundles).
 * @param {{ orderId?: string, qty?: number, all?: boolean }} body
 */
export const reclassifyOpenAsM4 = async (body, _params, user) => {
  const orderId = String(body.orderId || '').trim();
  if (!orderId) throw new ApiError(httpStatus.BAD_REQUEST, 'Order is required');
  const bundle = await PieceBundle.findOne({ orderId, closed: false }).sort({ number: -1 });
  if (!bundle || bundle.qty < 1) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'No leftover good quantity in the open bundle');
  }
  const moveAll = body.all === true;
  const amount = moveAll ? bundle.qty : wholeCount(body.qty, 'Quantity');
  if (amount < 1 || amount > bundle.qty) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Quantity must be between 1 and the leftover in the open bundle');
  }
  return runTransaction(async (session) => {
    bundle.qty -= amount;
    bundle.m4Qty = (Number(bundle.m4Qty) || 0) + amount;
    await bundle.save(sessionOptions(session));
    await writeOrderLog(
      {
        action: 'single-piece-m4-leftover',
        orderId: bundle.orderId,
        entityType: 'bundle',
        entityCode: bundle.barcode || `open-${bundle.number}`,
        quantity: amount,
        fromLocation: '',
        toLocation: '',
        remarks: `leftover to m4`,
      },
      user,
      session
    );
    const orderNumbers = await orderNumbersFor([String(bundle.orderId)]);
    return shapeBundle(bundle, orderNumbers);
  });
};

export const closeSinglePiece = async (body, _params, user) => {
  const orderId = String(body.orderId || '').trim();
  if (!orderId) throw new ApiError(httpStatus.BAD_REQUEST, 'Order is required');
  const bundle = await PieceBundle.findOne({ orderId, closed: false }).sort({ number: -1 });
  if (!bundle || bundle.qty < 1) throw new ApiError(httpStatus.BAD_REQUEST, 'An empty bundle cannot be closed');
  return runTransaction(async (session) => {
    bundle.closed = true;
    bundle.status = 'closed';
    bundle.barcode = bundle.barcode || nextCode('BD');
    await bundle.save(sessionOptions(session));
    await writeOrderLog(
      {
        action: 'single-piece-close',
        orderId: bundle.orderId,
        entityType: 'bundle',
        entityCode: bundle.barcode,
        quantity: bundle.qty,
        fromLocation: '',
        toLocation: '',
        remarks: '',
      },
      user,
      session
    );
    const orderNumbers = await orderNumbersFor([String(bundle.orderId)]);
    return shapeBundle(bundle, orderNumbers);
  });
};

/**
 * Puts closed bundles on a bundles rack. Checking still has to mark them.
 * @param {{ bundleBarcodes?: string[], rackCode?: string }} body
 * @param {object} [_params]
 * @param {object | null} [user]
 */
export const placeSinglePiece = async (body, _params, user) => {
  const codes = pieceCodes(body.bundleBarcodes);
  const rackCode = String(body.rackCode || '').trim();
  if (!codes.length) throw new ApiError(httpStatus.BAD_REQUEST, 'Bundle barcodes are required');
  if (!rackCode) throw new ApiError(httpStatus.BAD_REQUEST, 'Rack is required');
  const rack = await rackOf(rackCode, 'bundles', 'This rack is not for bundles');
  const bundles = await PieceBundle.find({ barcode: { $in: codes } });
  if (bundles.length !== codes.length) throw new ApiError(httpStatus.BAD_REQUEST, 'Bundle not found');
  for (const bundle of bundles) {
    if (!bundle.closed || !bundle.barcode) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Close the bundle before putting it on a rack');
    }
  }
  return runTransaction(async (session) => {
    await PieceBundle.updateMany({ barcode: { $in: codes } }, { rackCode: rack.code }, sessionOptions(session));
    for (const bundle of bundles) {
      await writeOrderLog(
        {
          action: 'bundle-place',
          orderId: bundle.orderId,
          entityType: 'bundle',
          entityCode: bundle.barcode,
          quantity: bundle.qty || 0,
          fromLocation: '',
          toLocation: rack.code,
          remarks: '',
        },
        user,
        session
      );
    }
    const placed = await PieceBundle.find({ barcode: { $in: codes } }).session(session || undefined);
    const orderNumbers = await orderNumbersFor([...new Set(placed.map((bundle) => String(bundle.orderId)))]);
    return placed.map((bundle) => shapeBundle(bundle, orderNumbers));
  });
};
