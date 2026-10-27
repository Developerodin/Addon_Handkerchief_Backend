import httpStatus from 'http-status';
import catchAsync from '../utils/catchAsync.js';
import { applyEvent, pullEvents, syncStatus, enqueueEvent } from '../services/sync/sync.service.js';
import * as store from '../services/store.service.js';
import * as packing from '../services/factory/packingList.service.js';
import * as receivedLots from '../services/factory/receivedLots.service.js';
import * as processRolls from '../services/factory/processRolls.service.js';
import * as grn from '../services/factory/grn.service.js';
import * as vendorReturns from '../services/factory/vendorReturn.service.js';
import * as production from '../services/production.service.js';
import * as orderRaise from '../services/production/orderRaise.service.js';
import * as orderViews from '../services/production/orderViews.service.js';
import * as quality from '../services/quality.service.js';
import * as warehouse from '../services/warehouse.service.js';
import * as invoice from '../services/invoice.service.js';
import * as reports from '../services/reports.service.js';
import * as lists from '../services/factoryLists.service.js';
import * as rackSlots from '../services/factory/rackSlots.service.js';
import * as fabricIssue from '../services/factory/fabricIssue.service.js';

/** @param {(body: object, params: object) => Promise<unknown>} work */
const send = (work, status = httpStatus.OK) =>
  catchAsync(async (req, res) => {
    const result = await work(req.body, req.params, req.user);
    res.status(status).send(typeof result === 'number' ? { count: result } : result);
  });

export const status = send(async () => syncStatus());
export const pull = send(async (body) => pullEvents(body));
export const enqueue = send(async (body) => enqueueEvent(body), httpStatus.CREATED);
export const apply = send(async (body) => applyEvent(body));

export const createPo = send(store.createPurchaseOrder, httpStatus.CREATED);
export const submitPo = send((_body, params, user) => store.submitPurchaseOrder(params.poId, user));
export const commercials = send((body, params) => store.setDraftCommercials(params.poId, body));
export const createLot = send((body) => store.createLot(body.poId, body.cutoffs), httpStatus.CREATED);
export const decideCutoffs = send((body, params) => store.decideCutoffs(params.lotId, body.decisions));
export const packingList = send(packing.createPackingList, httpStatus.CREATED);
export const updatePackingList = send((body, params) => packing.updatePackingList(params.listId, body));
export const saveReceivedLots = send((body, params, user) => receivedLots.saveReceivedLots(params.poId, body, user));
export const ensureProcessRolls = send((_body, params, user) => processRolls.ensureProcessRolls(params.poId, user));
export const updateProcessRoll = send((body, params) => processRolls.updateProcessRoll(params.rollId, body));
export const receive = send(store.receiveLot, httpStatus.CREATED);
export const rackRoll = send(store.rackRoll, httpStatus.CREATED);
export const addStorageRacks = send(rackSlots.addStorageRacks, httpStatus.CREATED);
export const unallocateRoll = send(rackSlots.unallocateRoll);
export const occupancy = send((_body, params) => store.rackOccupancy(params.rackCode));
export const issue = send(
  (body, _params, user) => (body.rollBarcode ? store.issueByBarcode(body, user) : store.issueRolls(body, user)),
  httpStatus.CREATED
);
export const returnRoll = send((body, _params, user) => store.receiveRollBack(body, null, user), httpStatus.CREATED);
export const vendorReturn = send((body, _params, user) => vendorReturns.createVendorReturn(body, user), httpStatus.CREATED);

export const updatePurchaseOrder = send((body, params) => store.updatePurchaseOrder(params.poId, body));
export const deletePurchaseOrder = send((_body, params) => store.deletePurchaseOrder(params.poId));
export const releaseOrder = send((body, params, user) => {
  if (Array.isArray(body.lines)) return orderRaise.createDraft(body, user);
  return production.releaseOrder(body, params, user);
}, httpStatus.CREATED);
export const updateOrder = send((body, params, user) => orderRaise.updateOrder(params.orderId, body, user));
export const releaseDraft = send((body, params, user) => orderRaise.releaseDraft(params.orderId, body, user));
export const holdOrder = send((body, params, user) => orderRaise.holdOrder(params.orderId, body, user));
export const deleteDraft = send((_body, params) => orderRaise.deleteDraft(params.orderId));
export const amendOrder = send((body, params, user) => production.amendOrder(params.orderId, body, user));
export const completeStage = send(production.completeStage, httpStatus.CREATED);
export const transferBundle = send((body, params, user) => production.transferBundle(params.orderId, body, user), httpStatus.CREATED);
export const receiveBundle = send(production.receiveBundle, httpStatus.CREATED);
export const cutRoll = send(production.cutRoll, httpStatus.CREATED);
export const closeBundle = send(production.closePartialBundle, httpStatus.CREATED);
export const hemBundle = send((_body, params) => production.hemBundle(params.bundleId));
export const breakBundle = send((body, params) => production.breakBundle(params.bundleId, body));
export const threadUse = send(production.recordThreadUse, httpStatus.CREATED);

export const grades = send(quality.ensureGrades);
export const renameGrade = send((body, params) => quality.renameGrade(params.code, body.name));
export const fabricSample = send(quality.recordFabricSample, httpStatus.CREATED);
export const passLot = send((_body, params) => quality.passLot(params.lotId));
export const decideReceivedLot = send((body, _params, user) => quality.decideReceivedLot(body, user));
export const rejectQcRoll = send((body) => quality.rejectQcRoll(body));
export const rejectRoll = send(quality.rejectRollToRack, httpStatus.CREATED);
export const bundleCheck = send(quality.recordBundleCheck, httpStatus.CREATED);
export const finalCheck = send(quality.recordFinalCheck, httpStatus.CREATED);

export const client = send(warehouse.createClient, httpStatus.CREATED);
export const clientOrder = send(warehouse.createClientOrder, httpStatus.CREATED);
export const packingBundle = send(warehouse.createPackingBundle, httpStatus.CREATED);
export const box = send(warehouse.createBox, httpStatus.CREATED);
export const rackBox = send(warehouse.rackBox);
export const dispatchBox = send(warehouse.dispatchBox);
export const traceBox = send((_body, params) => warehouse.traceBox(params.boxBarcode));

export const openInvoice = send(invoice.openInvoice, httpStatus.CREATED);
export const creditNote = send(invoice.createCreditNote, httpStatus.CREATED);
export const supplierBill = send(invoice.createSupplierBill, httpStatus.CREATED);

export const board = send(reports.reportBoard);
export const completions = send((body) => reports.completionReport(body));
export const rackReport = send((_body, params) => reports.rackReport(params.rackCode));

/** @param {(query: object, params: object) => Promise<unknown>} work */
const sendQuery = (work) =>
  catchAsync(async (req, res) => {
    res.send(await work(req.query, req.params));
  });

export const listPurchaseOrders = sendQuery(lists.listPurchaseOrders);
export const listFabricQcOrders = sendQuery((query) =>
  lists.listPurchaseOrders({ ...query, qcQueue: query.qcQueue === 'done' ? 'done' : 'pending' })
);
export const getFabricQcOrder = sendQuery((_query, params) => quality.getFabricQcOrder(params.poId));
export const getPurchaseOrder = sendQuery((_query, params) => lists.getPurchaseOrder(params.poId));
export const listLots = sendQuery(lists.listLots);
export const listPackingLists = sendQuery(lists.listPackingLists);
export const listReceipts = sendQuery(lists.listReceipts);
export const getReceipt = sendQuery((_query, params) => grn.getReceipt(params.id));
export const updateReceipt = send((body, params) => grn.updateReceipt(params.id, body));
export const receiptSummary = sendQuery((query) => grn.receiptSummary(query));
export const listRolls = sendQuery(lists.listRolls);
export const trackRoll = sendQuery((_query, params) => lists.trackRoll(params.code));
export const listReturnQueue = sendQuery(() => lists.listReturnQueue());
export const listVendorReturns = sendQuery(lists.listVendorReturns);
export const rollsOnRack = sendQuery((_query, params) => lists.rollsOnRack(params.rackCode));
export const rackBoard = sendQuery((query) => lists.rackBoard(query));
export const storageReport = sendQuery(() => rackSlots.storageReport());
export const listFabricIssues = sendQuery((query) => fabricIssue.listFabricIssues(query));
export const completeFabricIssue = send((body, params, user) => fabricIssue.completeFabricIssue(body, params, user));
export const listOrderLogs = sendQuery((query) => lists.listOrderLogs(query));
export const listOrderLogsForOrder = sendQuery((query, params) =>
  lists.listOrderLogs({ ...query, orderId: params.orderId })
);
export const listProductionOrders = sendQuery(lists.listProductionOrders);
export const listArticleLines = sendQuery(orderViews.listArticleLines);
export const fabricEstimation = sendQuery(orderViews.fabricEstimation);
export const upcomingFloors = sendQuery(orderViews.upcomingByFloor);
export const getProductionOrder = sendQuery((_query, params) => lists.getProductionOrder(params.orderId));
export const listClients = sendQuery(lists.listClients);
export const listClientOrders = sendQuery(lists.listClientOrders);
export const listPackingBundles = sendQuery(lists.listPackingBundles);
export const listBoxes = sendQuery(lists.listBoxes);
export const listInvoices = sendQuery(lists.listInvoices);
