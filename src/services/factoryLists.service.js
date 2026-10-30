import httpStatus from 'http-status';
import ApiError from '../utils/ApiError.js';
import {
  FabricLot,
  FabricRoll,
  GoodsReceipt,
  PackingList,
  PurchaseOrder,
  StockMovement,
  VendorReturn,
} from '../models/store.model.js';
import { FloorCompletion, PieceBundle, ProductionOrder, ProductionOrderLog } from '../models/production.model.js';
import { ClientOrder, DispatchBox, FactoryClient, PackingBundle } from '../models/warehouse.model.js';
import { SalesInvoice } from '../models/invoice.model.js';
import StorageRack from '../models/storageRack.model.js';
import { stampFloorOntoCodes } from './factory/rackSlots.service.js';
import { buildRollTrack } from './factory/rollTrack.service.js';
import { attachFabricIssue } from './factory/fabricIssue.service.js';
import { realFabricBom } from './production/orderSnapshot.js';

const OFF_RACK = new Set(['', 'floor', 'vendor', 'dispatched']);

/**
 * Inclusive date range. A date-only `to` covers that whole day.
 * @param {object} query
 */
const dateRange = (query) => {
  if (!query.from && !query.to) return null;
  const range = {};
  if (query.from) range.$gte = new Date(query.from);
  if (query.to) {
    const end = new Date(query.to);
    if (String(query.to).length <= 10) end.setHours(23, 59, 59, 999);
    range.$lte = end;
  }
  return range;
};

/**
 * Assigns ORD-000001 sequence numbers before a production-order read.
 * @param {import('mongoose').Model} Model
 */
const ensureOrderNumbers = async (Model) => {
  if (Model !== ProductionOrder) return;
  const { backfillOrderNumbers } = await import('./production/orderNumber.js');
  await backfillOrderNumbers();
};

/**
 * Pages a mongoose model in the catalog list shape.
 * @param {import('mongoose').Model} Model
 * @param {object} filter
 * @param {{ page?: string, limit?: string, sort?: string }} query
 */
export const pageOf = async (Model, filter, query) => {
  await ensureOrderNumbers(Model);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 20));
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const skip = (page - 1) * limit;
  const sort = query.sort === 'createdAt:asc' ? { createdAt: 1 } : { createdAt: -1 };
  const [results, totalResults] = await Promise.all([
    Model.find(filter).sort(sort).skip(skip).limit(limit),
    Model.countDocuments(filter),
  ]);
  return {
    results,
    page,
    limit,
    totalPages: Math.max(1, Math.ceil(totalResults / limit)),
    totalResults,
  };
};

/**
 * @param {object} query
 */
export const searchFilter = (query, fields) => {
  const filter = {};
  if (query.status) filter.status = query.status;
  if (query.qcStatus) filter.qcStatus = query.qcStatus;
  if (query.poId) filter.poId = query.poId;
  if (query.lotId) filter.lotId = query.lotId;
  if (query.search && fields.length) {
    const pattern = new RegExp(String(query.search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = fields.map((field) => ({ [field]: pattern }));
  }
  return filter;
};

/**
 * One purchase order for the edit screen.
 * @param {string} poId
 */
export const getPurchaseOrder = async (poId) => {
  const order = await PurchaseOrder.findById(poId);
  if (!order) throw new ApiError(httpStatus.NOT_FOUND, 'Purchase order not found');
  return order;
};

/**
 * Packlist quantity already recorded against each purchase order.
 * @param {import('mongoose').Document[]} orders
 */
async function receivedQuantityByPo(orders) {
  const received = new Map();
  const poIds = orders.map((order) => order._id);
  if (!poIds.length) return received;
  const lots = await FabricLot.find({ poId: { $in: poIds } }).select('_id poId').lean();
  if (!lots.length) return received;
  const lotToPo = new Map(lots.map((lot) => [String(lot._id), String(lot.poId)]));
  const lists = await PackingList.find({ lotId: { $in: lots.map((lot) => lot._id) } }).select('lotId quantity').lean();
  lists.forEach((list) => {
    const poId = lotToPo.get(String(list.lotId));
    if (!poId) return;
    received.set(poId, (received.get(poId) || 0) + (list.quantity || 0));
  });
  return received;
}

/**
 * Quantity already weighed in on goods receipts, in the same unit as the order line.
 * @param {import('mongoose').Document[]} orders
 */
async function goodsReceivedByPo(orders) {
  const received = new Map();
  const needRolls = [];
  orders.forEach((order) => {
    const fromLots = (order.receivedLots || []).reduce(
      (sum, lot) => sum + (lot.lines || []).reduce((inner, line) => inner + (Number(line.receivedQuantity) || 0), 0),
      0
    );
    if (fromLots > 0) received.set(String(order._id), fromLots);
    else needRolls.push(order._id);
  });
  if (!needRolls.length) return received;
  const rolls = await FabricRoll.find({ poId: { $in: needRolls } }).select('poId scaleWeight').lean();
  rolls.forEach((roll) => {
    const poId = String(roll.poId);
    received.set(poId, (received.get(poId) || 0) + (Number(roll.scaleWeight) || 0));
  });
  return received;
}

/**
 * A received lot still waiting for fabric QC. Missing status counts as pending.
 */
function pendingQcLotMatch() {
  return {
    rolls: { $gt: 0 },
    $or: [{ qcStatus: 'pending' }, { qcStatus: { $exists: false } }, { qcStatus: null }],
  };
}

/** @param {object} query */
export const listPurchaseOrders = async (query) => {
  const filter = searchFilter(query, ['number', 'supplierName', 'status']);
  const purchaseDate = dateRange(query);
  if (purchaseDate) filter.purchaseDate = purchaseDate;
  if (query.statusIn) {
    filter.status = { $in: String(query.statusIn).split(',').map((status) => status.trim()).filter(Boolean) };
  } else if (query.excludeDraft === '1' && !query.status) {
    filter.status = { $ne: 'Draft' };
  }
  if (query.qcQueue === 'pending') {
    filter.status = { $in: ['Partially Received', 'Received'] };
    filter.receivedLots = { $elemMatch: pendingQcLotMatch() };
  } else if (query.qcQueue === 'done') {
    filter.receivedLots = { $elemMatch: { qcStatus: { $in: ['passed', 'held', 'rejected'] } } };
  }
  const page = await pageOf(PurchaseOrder, filter, query);
  const [received, goodsReceived] = await Promise.all([
    receivedQuantityByPo(page.results),
    goodsReceivedByPo(page.results),
  ]);
  return {
    ...page,
    results: page.results.map((order) => ({
      ...order.toJSON(),
      receivedQuantity: received.get(String(order._id)) || 0,
      goodsReceivedQuantity: goodsReceived.get(String(order._id)) || 0,
    })),
  };
};

/**
 * Receipt asks only for approved lots whose PO is already in transit or partly received.
 * @param {object} query
 */
export const listLots = async (query) => {
  const filter = searchFilter(query, []);
  if (query.transit === '1') {
    const orders = await PurchaseOrder.find({ status: { $in: ['In Transit', 'Partially Received'] } }).select('_id');
    filter.poId = { $in: orders.map((order) => order._id) };
    filter.status = 'approved';
  }
  return pageOf(FabricLot, filter, query);
};

/**
 * GRN rows plus how many rolls that receipt created.
 * @param {object} query
 */
export const listReceipts = async (query) => {
  const filter = searchFilter(query, ['number', 'supplierName']);
  const receivedDate = dateRange(query);
  if (receivedDate) filter.receivedDate = receivedDate;
  const page = await pageOf(GoodsReceipt, filter, query);
  const results = await Promise.all(
    page.results.map(async (grn) => {
      const rollCount = await FabricRoll.countDocuments({ grnId: grn._id });
      return { ...grn.toJSON(), rollCount };
    })
  );
  return { ...page, results };
};

/**
 * Packlists for one purchase order, oldest first, so the transit drawer can refill them.
 * @param {object} query
 */
export const listPackingLists = async (query) => {
  const filter = {};
  if (query.poId) {
    const lots = await FabricLot.find({ poId: query.poId }).select('_id');
    filter.lotId = { $in: lots.map((lot) => lot._id) };
  } else if (query.lotId) {
    filter.lotId = query.lotId;
  }
  const results = await PackingList.find(filter).sort({ createdAt: 1 }).limit(50);
  return { results, page: 1, limit: 50, totalPages: 1, totalResults: results.length };
};

/**
 * One roll with purchase context and its event timeline.
 * @param {string} code
 */
export const trackRoll = (code) => buildRollTrack(code);

/**
 * Purchase orders that still have QC-rejected rolls waiting for a challan.
 */
export const listReturnQueue = async () => {
  const rolls = await FabricRoll.find({ qcStatus: 'rejected', status: { $ne: 'returned-to-vendor' } }).sort({ rollCode: 1 }).limit(500);
  const poIds = [...new Set(rolls.map((roll) => String(roll.poId)))];
  const orders = poIds.length ? await PurchaseOrder.find({ _id: { $in: poIds } }) : [];
  const held = new Set();
  orders.forEach((order) => {
    (order.receivedLots || []).forEach((lot) => {
      if (lot.qcStatus === 'held') held.add(`${String(order._id)}:${lot.lotNumber}`);
    });
  });
  const openRolls = rolls.filter((roll) => !held.has(`${String(roll.poId)}:${roll.receivedLotNumber}`));
  const openPoIds = new Set(openRolls.map((roll) => String(roll.poId)));
  return { orders: orders.filter((order) => openPoIds.has(String(order._id))), rolls: openRolls };
};

/** @param {object} query */
export const listVendorReturns = (query) => {
  const filter = searchFilter(query, ['reason', 'challanNumber', 'poNumber', 'supplierName']);
  const issuedAt = dateRange(query);
  if (issuedAt) filter.issuedAt = issuedAt;
  return pageOf(VendorReturn, filter, query);
};

/**
 * Rolls whose latest movement lands on this rack. Occupancy stays derived.
 * @param {string} rackCode
 */
export const rollsOnRack = async (rackCode) => {
  const rows = await StockMovement.find({ entityType: 'roll' }).sort({ createdAt: 1 });
  const latest = new Map();
  rows.forEach((row) => latest.set(row.entityId, row));
  const barcodes = [];
  latest.forEach((row, barcode) => {
    if (row.toLocation === rackCode) barcodes.push(barcode);
  });
  const rolls = barcodes.length ? await FabricRoll.find({ barcode: { $in: barcodes } }) : [];
  const logs = barcodes.length
    ? await ProductionOrderLog.find({ entityType: 'roll', entityCode: { $in: barcodes } }).sort({ at: -1 })
    : [];
  const lastLog = new Map();
  logs.forEach((log) => {
    if (!lastLog.has(log.entityCode)) lastLog.set(log.entityCode, log);
  });
  const poIds = [...new Set(rolls.map((roll) => String(roll.poId || '')).filter(Boolean))];
  const orders = poIds.length ? await PurchaseOrder.find({ _id: { $in: poIds } }).select('number') : [];
  const poNumbers = new Map(orders.map((order) => [String(order._id), order.number]));
  const results = rolls.map((roll) => {
    const log = lastLog.get(roll.barcode);
    const movement = latest.get(roll.barcode);
    return {
      ...roll.toJSON(),
      poNumber: poNumbers.get(String(roll.poId)) || '',
      lastUser: log?.userName || '',
      lastAt: log?.at || movement?.createdAt || null,
    };
  });
  const historyRows = await StockMovement.find({ entityType: 'roll', toLocation: rackCode }).sort({ createdAt: -1 }).limit(40);
  const history = historyRows.map((row) => ({
    id: String(row._id),
    barcode: row.entityId,
    kind: row.kind,
    fromLocation: row.fromLocation || '',
    toLocation: row.toLocation || '',
    at: row.createdAt,
  }));
  return { rackCode, results, history, totalResults: results.length };
};

/**
 * Active racks with a derived roll count. occupancy is empty or occupied.
 * @param {object} query
 */
export const rackBoard = async (query) => {
  await stampFloorOntoCodes();
  const racks = await StorageRack.find({ status: 'active' }).sort({ code: 1 });
  const rows = await StockMovement.find({ entityType: 'roll' }).sort({ createdAt: 1 });
  const latest = new Map();
  rows.forEach((row) => latest.set(row.entityId, row));
  const counts = new Map();
  const barcodesByRack = new Map();
  latest.forEach((row, barcode) => {
    if (OFF_RACK.has(row.toLocation || '')) return;
    const list = barcodesByRack.get(row.toLocation) || [];
    list.push(barcode);
    barcodesByRack.set(row.toLocation, list);
    counts.set(row.toLocation, (counts.get(row.toLocation) || 0) + 1);
  });
  const barcodes = [...barcodesByRack.values()].flat();
  const storedRolls = barcodes.length ? await FabricRoll.find({ barcode: { $in: barcodes } }).select('barcode fabricName') : [];
  const fabricByBarcode = new Map(storedRolls.map((roll) => [roll.barcode, roll.fabricName || '']));
  let results = racks.map((rack) => {
    const row = rack.toJSON();
    const fabrics = [...new Set((barcodesByRack.get(row.code) || []).map((barcode) => fabricByBarcode.get(barcode)).filter(Boolean))];
    return {
      code: row.code,
      name: row.name,
      barcode: row.barcode || row.code,
      location: row.location || '',
      floor: row.floor || '',
      zone: row.zone || '',
      status: row.status || 'active',
      count: counts.get(row.code) || 0,
      fabrics,
    };
  });
  if (query.occupancy === 'empty') results = results.filter((row) => row.count === 0);
  if (query.occupancy === 'occupied') results = results.filter((row) => row.count > 0);
  return { results, totalResults: results.length };
};

/**
 * Activity rows for one order or the whole floor. Filters are user, action, entity, and dates.
 * @param {object} query
 */
export const listOrderLogs = (query) => {
  const filter = {};
  if (query.orderId) filter.orderId = query.orderId;
  if (query.userId) filter.userId = query.userId;
  if (query.action) filter.action = query.action;
  if (query.entityType) filter.entityType = query.entityType;
  const at = dateRange(query);
  if (at) filter.at = at;
  return pageOf(ProductionOrderLog, filter, query);
};

/**
 * Issue queue is work still waiting on fabric. Return queue is orders that already have an issued roll.
 * @param {object} filter
 * @param {string} queue
 */
async function applyFabricQueue(filter, queue) {
  if (queue === 'issue') {
    filter.status = { $in: ['released', 'in-progress', 'amended'] };
    filter.$and = [
      ...(filter.$and || []),
      {
        $or: [
          { lines: { $elemMatch: { fabricIssueStatus: { $ne: 'completed' } } } },
          { lines: { $size: 0 } },
        ],
      },
    ];
    return;
  }
  if (queue !== 'return') return;
  const issuedIds = await StockMovement.distinct('orderId', {
    kind: 'issue',
    entityType: 'roll',
    orderId: { $ne: null },
  });
  filter._id = { $in: issuedIds };
  filter.status = { $nin: ['pending', 'closed'] };
}

/**
 * Orders list. Tile counts are for the whole collection, not the current page.
 * @param {object} query
 */
export const listProductionOrders = async (query) => {
  const filter = {};
  if (query.priority) filter.priority = query.priority;
  if (query.productionType) filter.productionType = query.productionType;
  if (query.revisionId) filter.revisionId = query.revisionId;
  if (query.floor) filter.currentFloor = query.floor;
  else if (query.currentFloor) filter.currentFloor = query.currentFloor;
  if (query.fabricQueue === 'issue' || query.fabricQueue === 'return') {
    await applyFabricQueue(filter, query.fabricQueue);
  } else if (query.tile === 'pending') filter.status = { $in: ['pending', 'released'] };
  else if (query.tile === 'in-progress') filter.status = { $in: ['in-progress', 'amended'] };
  else if (query.tile === 'completed') filter.status = 'closed';
  else if (query.tile === 'on-hold') filter.status = 'on-hold';
  else if (query.status) filter.status = query.status;
  if (query.search) {
    const pattern = new RegExp(String(query.search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [
      { orderNumber: pattern },
      { orderNote: pattern },
      { buyer: pattern },
      { 'lines.factoryCode': pattern },
      { 'lines.articleName': pattern },
    ];
  }
  const { orderStatusCounts } = await import('./production/orderViews.service.js');
  const [page, counts] = await Promise.all([pageOf(ProductionOrder, filter, query), orderStatusCounts()]);
  const results = await attachFabricIssue(page.results);
  return { ...page, results, counts };
};

/**
 * Order plus the completions and bundles already recorded against it.
 * @param {string} orderId
 */
export const getProductionOrder = async (orderId) => {
  await ensureOrderNumbers(ProductionOrder);
  const order = await ProductionOrder.findById(orderId);
  if (!order) throw new ApiError(httpStatus.NOT_FOUND, 'Production order not found');
  const json = order.toJSON();
  for (const line of json.lines || []) {
    if (!line.snapshot?.fabricBom) continue;
    line.snapshot.fabricBom = realFabricBom(line.snapshot.fabricBom);
  }
  const [completions, bundles] = await Promise.all([
    FloorCompletion.find({ orderId: order.id }),
    PieceBundle.find({ orderId: order.id }),
  ]);
  return { order: json, completions, bundles };
};

/** @param {object} query */
export const listClients = (query) => pageOf(FactoryClient, searchFilter(query, ['name']), query);

/** @param {object} query */
export const listClientOrders = (query) =>
  pageOf(ClientOrder, searchFilter(query, ['clientName', 'status']), query);

/** @param {object} query */
export const listPackingBundles = (query) =>
  pageOf(PackingBundle, searchFilter(query, ['barcode']), query);

/** @param {object} query */
export const listBoxes = (query) => pageOf(DispatchBox, searchFilter(query, ['barcode', 'status']), query);

/** @param {object} query */
export const listInvoices = (query) => pageOf(SalesInvoice, searchFilter(query, ['number']), query);
