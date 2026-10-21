import express from 'express';
import auth from '../../middlewares/auth.js';
import { requireAnyCrudPath, requireCrud } from '../../middlewares/requireCrud.js';
import * as factory from '../../controllers/factory.controller.js';

const router = express.Router();

/**
 * Guards one factory screen key.
 * @param {string} key
 * @param {'create'|'read'|'update'|'delete'} action
 */
const guard = (key, action) => [auth(), requireCrud(key, action)];

const SYNC = 'Sync';
const PO = 'Store / Purchase orders';
const RECEIPT = 'Store / Receipt';
const RACKS = 'Store / Racks and issue';
const ORDERS = 'Production / Orders';
const FLOOR = 'Production / Floor';
const FLOOR_SCREENS = [
  FLOOR,
  'Production / Cut',
  'Production / Selvage',
  'Production / Half moon',
  'Production / Vertical hem',
  'Production / Bundle',
  'Production / Horizontal hem',
  'Production / Thread cut',
  'Production / Iron',
  'Production / Route split',
  'Production / Embroidery',
  'Production / Sticker',
];
const FABRIC_QC = 'Quality / Fabric QC';
const FLOOR_QC = 'Quality / Floor checks';
const GRADES = 'Quality / Grades';
const PACKING = 'Warehouse / Packing';
const BOXES = 'Warehouse / Boxes';
const CLIENT_ORDERS = 'Warehouse / Orders';
const DISPATCH = 'Warehouse / Dispatch';
const INVOICES = 'Accounts / Invoices';
const REPORTS = 'Reports';
const F_PO = 'Fabric / Purchase orders';
const F_DRAFTS = 'Fabric / Drafts';
const F_RECEIPTS = 'Fabric / Receipts';
const F_GRN = 'Fabric / GRN history';
const F_VENDOR = 'Fabric / Vendor return';
const F_CHALLAN = 'Fabric / Return challan';
const F_ISSUE = 'Fabric / Issue';
const F_RETURN = 'Fabric / Return';
const F_STORAGE = 'Fabric / Storage';
const F_LIVE = 'Fabric / Live inventory';
const F_STOCK = 'Fabric / Stock report';
const F_PO_ANALYTICS = 'Fabric / PO analytics';
const F_FABRIC_ANALYTICS = 'Fabric / Fabric analytics';

/**
 * Allow the older Store key or any Fabric Management screen that uses the route.
 * @param {'create'|'read'|'update'|'delete'} action
 * @param {string[]} keys
 */
const screens = (action, keys) => [auth(), requireAnyCrudPath(keys.map((path) => ({ path, action })))];

router.get('/sync/status', ...guard(SYNC, 'read'), factory.status);
router.post('/sync/pull', ...guard(SYNC, 'read'), factory.pull);
router.post('/sync/events', ...guard(SYNC, 'create'), factory.enqueue);
router.post('/sync/apply', ...guard(SYNC, 'update'), factory.apply);

const poRead = [PO, F_PO, F_DRAFTS, F_PO_ANALYTICS];
const poWrite = [PO, F_PO, F_DRAFTS];
const receiptRead = [RECEIPT, F_RECEIPTS, F_GRN, F_VENDOR, F_CHALLAN, F_FABRIC_ANALYTICS];
const rackRead = [RACKS, F_STORAGE, F_ISSUE, F_RETURN, F_LIVE, F_STOCK];

router.get('/store/purchase-orders', ...screens('read', poRead), factory.listPurchaseOrders);
router.post('/store/purchase-orders', ...screens('create', poWrite), factory.createPo);
router.get('/store/purchase-orders/:poId', ...screens('read', poRead), factory.getPurchaseOrder);
router.post('/store/purchase-orders/:poId/submit', ...screens('update', poWrite), factory.submitPo);
router.patch('/store/purchase-orders/:poId/commercials', ...screens('update', poWrite), factory.commercials);
router.get(
  '/store/lots',
  auth(),
  requireAnyCrudPath([
    ...poRead.map((path) => ({ path, action: 'read' })),
    { path: F_RECEIPTS, action: 'read' },
    { path: F_FABRIC_ANALYTICS, action: 'read' },
    { path: FABRIC_QC, action: 'read' },
  ]),
  factory.listLots
);
router.post('/store/lots', ...screens('create', poWrite), factory.createLot);
router.post('/store/lots/:lotId/cutoffs', ...screens('update', poWrite), factory.decideCutoffs);
router.get('/store/receipts', ...screens('read', receiptRead), factory.listReceipts);
router.get('/store/receipt-summary', ...screens('read', receiptRead), factory.receiptSummary);
router.get('/store/receipts/:id', ...screens('read', receiptRead), factory.getReceipt);
router.patch('/store/receipts/:id', ...screens('update', [RECEIPT, F_GRN]), factory.updateReceipt);
router.get(
  '/store/rolls',
  auth(),
  requireAnyCrudPath([
    ...rackRead.map((path) => ({ path, action: 'read' })),
    ...receiptRead.map((path) => ({ path, action: 'read' })),
    { path: FLOOR_QC, action: 'read' },
  ]),
  factory.listRolls
);
router.get('/store/rolls/track/:code', ...screens('read', rackRead), factory.trackRoll);
router.patch('/store/rolls/:rollId', ...screens('update', [RECEIPT, F_RECEIPTS]), factory.updateProcessRoll);
router.get('/store/return-queue', ...screens('read', [RECEIPT, F_VENDOR, F_CHALLAN]), factory.listReturnQueue);
router.get('/store/vendor-returns', ...screens('read', [RECEIPT, F_VENDOR, F_CHALLAN, F_FABRIC_ANALYTICS]), factory.listVendorReturns);
router.get('/store/packing-lists', ...screens('read', [...poRead, RECEIPT, F_RECEIPTS]), factory.listPackingLists);
router.post(
  '/store/packing-lists',
  auth(),
  requireAnyCrudPath([
    ...poWrite.map((path) => ({ path, action: 'update' })),
    { path: RECEIPT, action: 'create' },
    { path: F_RECEIPTS, action: 'create' },
  ]),
  factory.packingList
);
router.patch('/store/packing-lists/:listId', ...screens('update', poWrite), factory.updatePackingList);
router.patch('/store/purchase-orders/:poId/received-lots', ...screens('create', [RECEIPT, F_RECEIPTS]), factory.saveReceivedLots);
router.post('/store/purchase-orders/:poId/process-rolls', ...screens('create', [RECEIPT, F_RECEIPTS]), factory.ensureProcessRolls);
router.patch('/store/purchase-orders/:poId', ...screens('update', poWrite), factory.updatePurchaseOrder);
router.delete('/store/purchase-orders/:poId', ...screens('delete', poWrite), factory.deletePurchaseOrder);
router.post('/store/receipts', ...screens('create', [RECEIPT, F_RECEIPTS]), factory.receive);
router.post('/store/vendor-returns', ...screens('create', [RECEIPT, F_VENDOR]), factory.vendorReturn);
router.post('/store/racks', ...screens('create', [RACKS, F_STORAGE]), factory.rackRoll);
router.post('/store/racks/unallocate', ...screens('create', [RACKS, F_STORAGE]), factory.unallocateRoll);
router.post('/store/rack-slots', ...screens('create', [RACKS, F_STORAGE]), factory.addStorageRacks);
router.get('/store/racks/:rackCode/occupancy', ...screens('read', rackRead), factory.occupancy);
router.get('/store/rack-board', ...screens('read', rackRead), factory.rackBoard);
router.get('/store/storage-report', ...screens('read', rackRead), factory.storageReport);
router.get('/store/racks/:rackCode', ...screens('read', rackRead), factory.rollsOnRack);
router.post('/store/issues', ...screens('create', [RACKS, F_ISSUE]), factory.issue);
router.post(
  '/store/returns',
  auth(),
  requireAnyCrudPath([
    { path: RACKS, action: 'create' },
    { path: F_RETURN, action: 'create' },
    { path: RECEIPT, action: 'create' },
  ]),
  factory.returnRoll
);

const logRead = [
  { path: ORDERS, action: 'read' },
  ...FLOOR_SCREENS.map((path) => ({ path, action: 'read' })),
  { path: RACKS, action: 'read' },
  { path: RECEIPT, action: 'read' },
  { path: FLOOR_QC, action: 'read' },
  { path: PACKING, action: 'read' },
  { path: BOXES, action: 'read' },
  { path: DISPATCH, action: 'read' },
];

router.get('/production/logs', auth(), requireAnyCrudPath(logRead), factory.listOrderLogs);
router.get(
  '/production/orders',
  auth(),
  requireAnyCrudPath([
    { path: ORDERS, action: 'read' },
    ...FLOOR_SCREENS.map((path) => ({ path, action: 'read' })),
    { path: RACKS, action: 'read' },
    { path: PACKING, action: 'read' },
    { path: BOXES, action: 'read' },
    { path: FLOOR_QC, action: 'read' },
    { path: INVOICES, action: 'read' },
  ]),
  factory.listProductionOrders
);
router.get(
  '/production/orders/:orderId/logs',
  auth(),
  requireAnyCrudPath(logRead),
  factory.listOrderLogsForOrder
);
router.get(
  '/production/orders/:orderId',
  auth(),
  requireAnyCrudPath([
    { path: ORDERS, action: 'read' },
    { path: FLOOR_QC, action: 'read' },
  ]),
  factory.getProductionOrder
);
router.post('/production/orders', ...guard(ORDERS, 'create'), factory.releaseOrder);
router.post('/production/orders/:orderId/amend', ...guard(ORDERS, 'update'), factory.amendOrder);
router.post('/production/orders/:orderId/transfer', ...screens('create', FLOOR_SCREENS), factory.transferBundle);
router.post('/production/completions', ...screens('create', FLOOR_SCREENS), factory.completeStage);
router.post('/production/bundles/receive', ...screens('create', FLOOR_SCREENS), factory.receiveBundle);
router.post('/production/cuts', ...screens('create', FLOOR_SCREENS), factory.cutRoll);
router.post('/production/bundles/close', ...screens('create', FLOOR_SCREENS), factory.closeBundle);
router.post('/production/bundles/:bundleId/hem', ...screens('update', FLOOR_SCREENS), factory.hemBundle);
router.post('/production/bundles/:bundleId/break', ...screens('update', FLOOR_SCREENS), factory.breakBundle);
router.post('/production/thread', ...screens('create', FLOOR_SCREENS), factory.threadUse);

router.get('/quality/grades', ...guard(GRADES, 'read'), factory.grades);
router.patch('/quality/grades/:code', ...guard(GRADES, 'update'), factory.renameGrade);
router.post('/quality/fabric-samples', ...guard(FABRIC_QC, 'create'), factory.fabricSample);
router.post('/quality/lots/:lotId/pass', ...guard(FABRIC_QC, 'update'), factory.passLot);
router.get('/quality/fabric-orders', ...guard(FABRIC_QC, 'read'), factory.listFabricQcOrders);
router.get('/quality/fabric-orders/:poId', ...guard(FABRIC_QC, 'read'), factory.getFabricQcOrder);
router.post('/quality/received-lots', ...guard(FABRIC_QC, 'update'), factory.decideReceivedLot);
router.post('/quality/rolls/reject', ...guard(FABRIC_QC, 'update'), factory.rejectQcRoll);
router.post('/quality/roll-rejections', ...guard(FLOOR_QC, 'create'), factory.rejectRoll);
router.post('/quality/bundle-checks', ...guard(FLOOR_QC, 'create'), factory.bundleCheck);
router.post('/quality/final-checks', ...guard(FLOOR_QC, 'create'), factory.finalCheck);

router.get('/warehouse/clients', ...guard(CLIENT_ORDERS, 'read'), factory.listClients);
router.post('/warehouse/clients', ...guard(CLIENT_ORDERS, 'create'), factory.client);
router.get(
  '/warehouse/orders',
  auth(),
  requireAnyCrudPath([
    { path: CLIENT_ORDERS, action: 'read' },
    { path: BOXES, action: 'read' },
  ]),
  factory.listClientOrders
);
router.post('/warehouse/orders', ...guard(CLIENT_ORDERS, 'create'), factory.clientOrder);
router.get(
  '/warehouse/packing-bundles',
  auth(),
  requireAnyCrudPath([
    { path: PACKING, action: 'read' },
    { path: BOXES, action: 'read' },
  ]),
  factory.listPackingBundles
);
router.post('/warehouse/packing-bundles', ...guard(PACKING, 'create'), factory.packingBundle);
router.get(
  '/warehouse/boxes',
  auth(),
  requireAnyCrudPath([
    { path: BOXES, action: 'read' },
    { path: DISPATCH, action: 'read' },
    { path: INVOICES, action: 'read' },
  ]),
  factory.listBoxes
);
router.post('/warehouse/boxes', ...guard(BOXES, 'create'), factory.box);
router.post('/warehouse/boxes/rack', ...guard(BOXES, 'update'), factory.rackBox);
router.post('/warehouse/dispatch', ...guard(DISPATCH, 'create'), factory.dispatchBox);
router.get('/warehouse/boxes/:boxBarcode/trace', ...guard(DISPATCH, 'read'), factory.traceBox);

router.get('/accounts/invoices', ...guard(INVOICES, 'read'), factory.listInvoices);
router.post('/accounts/invoices', ...guard(INVOICES, 'create'), factory.openInvoice);
router.post('/accounts/credit-notes', ...guard(INVOICES, 'create'), factory.creditNote);
router.post('/accounts/supplier-bills', ...guard(INVOICES, 'create'), factory.supplierBill);

router.get(
  '/reports/board',
  ...screens('read', [REPORTS, F_LIVE, F_STOCK, F_PO_ANALYTICS, F_FABRIC_ANALYTICS]),
  factory.board
);
router.post(
  '/reports/completions',
  ...screens('read', [REPORTS, F_LIVE, F_STOCK, F_PO_ANALYTICS, F_FABRIC_ANALYTICS]),
  factory.completions
);
router.get(
  '/reports/racks/:rackCode',
  ...screens('read', [REPORTS, F_LIVE, F_STOCK, F_FABRIC_ANALYTICS]),
  factory.rackReport
);

export default router;
