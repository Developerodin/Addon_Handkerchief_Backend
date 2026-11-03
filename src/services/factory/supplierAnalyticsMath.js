import { isOpenOrder, round3, stillDue, sumOrdered, sumReceivedLots, supplierLabel } from './poAnalyticsMath.js';

const TYPE_CAP = 4;
const RECENT_CAP = 8;

/**
 * Trimmed lowercase key so "Mill A" and "mill a" share a row.
 * @param {unknown} name
 */
export function nameKey(name) {
  return String(name || '')
    .trim()
    .toLowerCase();
}

/**
 * Blank purchase-order names share the unknown-supplier row.
 * @param {unknown} name
 */
function supplierKey(name) {
  return nameKey(name) || nameKey(supplierLabel(name));
}

/**
 * @param {unknown} value
 */
function iso(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

/**
 * @param {string} supplierName
 */
function emptyBucket(supplierName) {
  return {
    supplierName,
    city: '',
    status: 'not listed',
    contactPerson: '',
    orders: 0,
    drafts: 0,
    currentOrders: 0,
    orderedQty: 0,
    receivedQty: 0,
    returns: 0,
    returnQty: 0,
    qcPassedMeters: 0,
    qcFailedMeters: 0,
    qcHeldMeters: 0,
    qcPassedRolls: 0,
    qcFailedRolls: 0,
    qcHeldRolls: 0,
    fabricNames: new Set(),
    fabricTypeLabels: new Map(),
  };
}

/**
 * Ordered, received, and whether the order is still open. Drafts are not purchases.
 * @param {{ status?: string, lines?: { quantity?: number }[], receivedLots?: { lines?: { receivedQuantity?: number }[] }[] }} order
 */
export function orderFigures(order) {
  const ordered = sumOrdered(order.lines);
  const received = sumReceivedLots(order.receivedLots);
  const due = stillDue(ordered, received);
  return {
    isDraft: order.status === 'Draft',
    current: isOpenOrder(order.status, due),
    ordered,
    received,
    stillDue: due,
  };
}

/**
 * Received quantity per purchase-order line.
 * @param {{ lines?: { lineId?: string, receivedQuantity?: number }[] }[]} lots
 */
function receivedByLine(lots) {
  const totals = new Map();
  (lots || []).forEach((lot) => {
    (lot.lines || []).forEach((line) => {
      if (!line.lineId) return;
      totals.set(line.lineId, (totals.get(line.lineId) || 0) + (Number(line.receivedQuantity) || 0));
    });
  });
  return totals;
}

/**
 * @param {ReturnType<typeof emptyBucket>} bucket
 * @param {unknown} fabricName
 */
function rememberFabric(bucket, fabricName) {
  const label = String(fabricName || '').trim() || 'Unnamed fabric';
  bucket.fabricNames.add(nameKey(label));
}

/**
 * @param {ReturnType<typeof emptyBucket>} bucket
 * @param {unknown} typeName
 */
function rememberType(bucket, typeName) {
  const label = String(typeName || '').trim();
  const key = nameKey(label);
  if (!key || bucket.fabricTypeLabels.has(key)) return;
  bucket.fabricTypeLabels.set(key, label);
}

/**
 * Adds one purchase order. Draft quantity and draft fabrics are ignored.
 * @param {ReturnType<typeof emptyBucket>} bucket
 * @param {{ status?: string, lines?: { lineId?: string, fabricName?: string, fabricTypeName?: string, quantity?: number }[], receivedLots?: object[] }} order
 */
export function addOrder(bucket, order) {
  const figures = orderFigures(order);
  bucket.receivedQty += figures.received;
  if (figures.isDraft) {
    bucket.drafts += 1;
    return;
  }
  bucket.orders += 1;
  bucket.orderedQty += figures.ordered;
  if (figures.current) bucket.currentOrders += 1;
  (order.lines || []).forEach((line) => {
    rememberFabric(bucket, line.fabricName);
    rememberType(bucket, line.fabricTypeName);
  });
}

/**
 * @param {Map<string, ReturnType<typeof emptyBucket>>} buckets
 * @param {{ name?: string, city?: string, status?: string, contactPerson?: string }} supplier
 */
function applyCatalogRow(buckets, supplier) {
  if (!nameKey(supplier.name)) return;
  const key = supplierKey(supplier.name);
  if (!buckets.has(key)) buckets.set(key, emptyBucket(supplier.name));
  const bucket = buckets.get(key);
  bucket.supplierName = supplier.name;
  bucket.city = supplier.city || '';
  bucket.status = supplier.status || 'active';
  bucket.contactPerson = supplier.contactPerson || '';
}

/**
 * Metres come from the roll. Rejected rolls often have no metres yet, so the roll count is kept too.
 * @param {ReturnType<typeof emptyBucket>} bucket
 * @param {string} status
 * @param {number} meters
 * @param {number} rolls
 */
function addQc(bucket, status, meters, rolls) {
  const qty = Number(meters) || 0;
  const count = Number(rolls) || 0;
  if (status === 'passed') {
    bucket.qcPassedMeters += qty;
    bucket.qcPassedRolls += count;
  } else if (status === 'rejected') {
    bucket.qcFailedMeters += qty;
    bucket.qcFailedRolls += count;
  } else if (status === 'held') {
    bucket.qcHeldMeters += qty;
    bucket.qcHeldRolls += count;
  }
}

/**
 * Rolls are stored on the purchase order, so QC follows that order's supplier.
 * @param {Map<string, ReturnType<typeof emptyBucket>>} buckets
 * @param {{ _id?: unknown, id?: unknown, supplierName?: string }[]} orders
 * @param {{ poId?: unknown, qcStatus?: string, meters?: number, rolls?: number }[]} qcRows
 */
function applyQc(buckets, orders, qcRows) {
  const supplierOf = new Map();
  (orders || []).forEach((order) => {
    supplierOf.set(String(order._id || order.id), supplierKey(order.supplierName));
  });
  (qcRows || []).forEach((row) => {
    const bucket = buckets.get(supplierOf.get(String(row.poId)) || '');
    if (!bucket) return;
    addQc(bucket, row.qcStatus || 'pending', row.meters, row.rolls);
  });
}

/**
 * @param {Map<string, ReturnType<typeof emptyBucket>>} buckets
 * @param {{ supplierName?: string, returns?: number, returnQty?: number }} item
 */
function applyReturn(buckets, item) {
  const key = supplierKey(item.supplierName);
  if (!buckets.has(key)) buckets.set(key, emptyBucket(supplierLabel(item.supplierName)));
  const bucket = buckets.get(key);
  bucket.returns += Number(item.returns) || 0;
  bucket.returnQty += Number(item.returnQty) || 0;
}

/**
 * @param {ReturnType<typeof emptyBucket>} bucket
 */
function finalize(bucket) {
  const fabricTypes = [...bucket.fabricTypeLabels.values()].sort((left, right) => left.localeCompare(right));
  return {
    supplierName: bucket.supplierName,
    city: bucket.city,
    status: bucket.status,
    contactPerson: bucket.contactPerson,
    orders: bucket.orders,
    drafts: bucket.drafts,
    currentOrders: bucket.currentOrders,
    orderedQty: round3(bucket.orderedQty),
    receivedQty: round3(bucket.receivedQty),
    fabricCount: bucket.fabricNames.size,
    fabricTypes: fabricTypes.slice(0, TYPE_CAP),
    qcPassedMeters: round3(bucket.qcPassedMeters),
    qcFailedMeters: round3(bucket.qcFailedMeters),
    qcHeldMeters: round3(bucket.qcHeldMeters),
    qcPassedRolls: bucket.qcPassedRolls,
    qcFailedRolls: bucket.qcFailedRolls,
    qcHeldRolls: bucket.qcHeldRolls,
    returns: bucket.returns,
    returnQty: round3(bucket.returnQty),
  };
}

/**
 * @param {ReturnType<typeof finalize>[]} suppliers
 */
function sumTotals(suppliers) {
  const totals = suppliers.reduce(
    (sum, row) => ({
      suppliers: sum.suppliers + 1,
      orders: sum.orders + row.orders,
      currentOrders: sum.currentOrders + row.currentOrders,
      orderedQty: sum.orderedQty + row.orderedQty,
      receivedQty: sum.receivedQty + row.receivedQty,
      returns: sum.returns + row.returns,
      returnQty: sum.returnQty + row.returnQty,
      qcPassedMeters: sum.qcPassedMeters + row.qcPassedMeters,
      qcFailedMeters: sum.qcFailedMeters + row.qcFailedMeters,
    }),
    {
      suppliers: 0,
      orders: 0,
      currentOrders: 0,
      orderedQty: 0,
      receivedQty: 0,
      returns: 0,
      returnQty: 0,
      qcPassedMeters: 0,
      qcFailedMeters: 0,
    }
  );
  return {
    ...totals,
    orderedQty: round3(totals.orderedQty),
    receivedQty: round3(totals.receivedQty),
    returnQty: round3(totals.returnQty),
    qcPassedMeters: round3(totals.qcPassedMeters),
    qcFailedMeters: round3(totals.qcFailedMeters),
  };
}

/**
 * One row per supplier for the report list.
 * @param {{ orders?: object[], qcRows?: { poId?: unknown, qcStatus?: string, meters?: number }[], returnBuckets?: object[], catalog?: object[] }} input
 */
export function mergeSupplierList({ orders = [], qcRows = [], returnBuckets = [], catalog = [] }) {
  const buckets = new Map();
  orders.forEach((order) => {
    const key = supplierKey(order.supplierName);
    if (!buckets.has(key)) buckets.set(key, emptyBucket(supplierLabel(order.supplierName)));
    addOrder(buckets.get(key), order);
  });
  returnBuckets.forEach((item) => applyReturn(buckets, item));
  catalog.forEach((supplier) => applyCatalogRow(buckets, supplier));
  applyQc(buckets, orders, qcRows);
  const suppliers = [...buckets.values()]
    .map(finalize)
    .sort((left, right) => right.orderedQty - left.orderedQty || left.supplierName.localeCompare(right.supplierName));
  return { totals: sumTotals(suppliers), suppliers };
}

/**
 * Pass, fail, hold, and pending roll counts for one supplier.
 * @param {{ qcStatus?: string, meters?: number, rolls?: number }[]} rows
 */
export function qcTotals(rows) {
  const bucket = {
    qcPassedMeters: 0,
    qcFailedMeters: 0,
    qcHeldMeters: 0,
    qcPassedRolls: 0,
    qcFailedRolls: 0,
    qcHeldRolls: 0,
    qcPendingRolls: 0,
  };
  (rows || []).forEach((row) => {
    const meters = Number(row.meters) || 0;
    const rolls = Number(row.rolls) || 0;
    if (row.qcStatus === 'passed') {
      bucket.qcPassedMeters += meters;
      bucket.qcPassedRolls += rolls;
    } else if (row.qcStatus === 'rejected') {
      bucket.qcFailedMeters += meters;
      bucket.qcFailedRolls += rolls;
    } else if (row.qcStatus === 'held') {
      bucket.qcHeldMeters += meters;
      bucket.qcHeldRolls += rolls;
    } else bucket.qcPendingRolls += rolls;
  });
  return {
    qcPassedMeters: round3(bucket.qcPassedMeters),
    qcFailedMeters: round3(bucket.qcFailedMeters),
    qcHeldMeters: round3(bucket.qcHeldMeters),
    qcPassedRolls: bucket.qcPassedRolls,
    qcFailedRolls: bucket.qcFailedRolls,
    qcHeldRolls: bucket.qcHeldRolls,
    qcPendingRolls: bucket.qcPendingRolls,
  };
}

/**
 * Fabric name and type purchased from this supplier, drafts excluded.
 * @param {object[]} orders
 */
export function fabricLines(orders) {
  const rows = new Map();
  (orders || []).forEach((order) => {
    if (order.status === 'Draft') return;
    const received = receivedByLine(order.receivedLots);
    (order.lines || []).forEach((line) => {
      const fabricName = String(line.fabricName || '').trim() || 'Unnamed fabric';
      const fabricTypeName = String(line.fabricTypeName || '').trim();
      const key = `${nameKey(fabricName)}|${nameKey(fabricTypeName)}`;
      if (!rows.has(key)) rows.set(key, { fabricName, fabricTypeName, orderedQty: 0, receivedQty: 0 });
      const row = rows.get(key);
      row.orderedQty += Number(line.quantity) || 0;
      row.receivedQty += received.get(line.lineId) || 0;
    });
  });
  return [...rows.values()]
    .map((row) => ({
      fabricName: row.fabricName,
      fabricTypeName: row.fabricTypeName,
      orderedQty: round3(row.orderedQty),
      receivedQty: round3(row.receivedQty),
    }))
    .sort((left, right) => right.orderedQty - left.orderedQty || left.fabricName.localeCompare(right.fabricName));
}

/**
 * @param {object} order
 */
function poCard(order) {
  const figures = orderFigures(order);
  return {
    id: String(order._id || order.id || ''),
    number: order.number || '',
    status: order.status || '',
    purchaseDate: iso(order.purchaseDate),
    ordered: round3(figures.ordered),
    received: round3(figures.received),
    stillDue: round3(figures.stillDue),
    current: figures.current,
    isDraft: figures.isDraft,
  };
}

/**
 * @param {ReturnType<typeof poCard>} card
 */
function publicCard(card) {
  return {
    id: card.id,
    number: card.number,
    status: card.status,
    purchaseDate: card.purchaseDate,
    ordered: card.ordered,
    received: card.received,
    stillDue: card.stillDue,
  };
}

/**
 * @param {ReturnType<typeof poCard>} left
 * @param {ReturnType<typeof poCard>} right
 */
function byDateDesc(left, right) {
  return String(right.purchaseDate || '').localeCompare(String(left.purchaseDate || ''));
}

/**
 * @param {object[] | object | null | undefined} catalog
 * @param {string} key
 */
function catalogMatch(catalog, key) {
  let rows = [];
  if (Array.isArray(catalog)) rows = catalog;
  else if (catalog) rows = [catalog];
  return rows.find((supplier) => supplierKey(supplier.name) === key) || null;
}

/**
 * Lifetime dossier for one supplier. Null when nothing matches the name.
 * @param {{ name: string, catalog?: object[] | object | null, orders?: object[], qcRows?: object[], returns?: object[] }} input
 */
export function buildSupplierDetail({ name, catalog = [], orders = [], qcRows = [], returns = [] }) {
  const key = supplierKey(name);
  const matchedOrders = orders.filter((order) => supplierKey(order.supplierName) === key);
  const matchedReturns = returns.filter((item) => supplierKey(item.supplierName) === key);
  const listed = catalogMatch(catalog, key);
  if (!listed && !matchedOrders.length && !matchedReturns.length) return null;

  const bucket = emptyBucket(listed ? listed.name : supplierLabel(name));
  if (listed) applyCatalogRow(new Map([[key, bucket]]), listed);
  matchedOrders.forEach((order) => addOrder(bucket, order));
  bucket.returns = matchedReturns.length;
  bucket.returnQty = matchedReturns.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
  const row = finalize(bucket);
  const qc = qcTotals(qcRows);
  const cards = matchedOrders.map(poCard).sort(byDateDesc);
  return {
    header: {
      supplierName: row.supplierName,
      city: row.city,
      status: row.status,
      contactPerson: row.contactPerson,
    },
    kpis: {
      orders: row.orders,
      currentOrders: row.currentOrders,
      orderedQty: row.orderedQty,
      receivedQty: row.receivedQty,
      fabricCount: row.fabricCount,
      ...qc,
      returns: row.returns,
      returnQty: row.returnQty,
    },
    fabrics: fabricLines(matchedOrders),
    currentOrders: cards.filter((card) => card.current).map(publicCard),
    recentOrders: cards
      .filter((card) => !card.isDraft)
      .slice(0, RECENT_CAP)
      .map(publicCard),
    returns: matchedReturns
      .map((item) => ({
        reason: item.reason || '',
        quantity: round3(item.quantity),
        poNumber: item.poNumber || '',
        issuedAt: iso(item.issuedAt),
      }))
      .sort((left, right) => String(right.issuedAt || '').localeCompare(String(left.issuedAt || ''))),
  };
}
