import httpStatus from 'http-status';
import catchAsync from '../utils/catchAsync.js';
import * as checkpointService from '../services/checkpoint.service.js';

const listCheckpoints = catchAsync(async (req, res) => {
  const result = await checkpointService.listCheckpoints();
  res.send(result);
});

const createModule = catchAsync(async (req, res) => {
  const moduleDoc = await checkpointService.createModule(req.body, req.user);
  res.status(httpStatus.CREATED).send(moduleDoc);
});

const updateModule = catchAsync(async (req, res) => {
  const moduleDoc = await checkpointService.updateModule(req.params.moduleId, req.body, req.user);
  res.send(moduleDoc);
});

const deleteModule = catchAsync(async (req, res) => {
  await checkpointService.deleteModule(req.params.moduleId, req.user);
  res.status(httpStatus.NO_CONTENT).send();
});

const createItem = catchAsync(async (req, res) => {
  const item = await checkpointService.createItem(req.params.moduleId, req.body, req.user);
  res.status(httpStatus.CREATED).send(item);
});

const updateItem = catchAsync(async (req, res) => {
  const item = await checkpointService.updateItem(req.params.itemId, req.body, req.user);
  res.send(item);
});

const deleteItem = catchAsync(async (req, res) => {
  await checkpointService.deleteItem(req.params.itemId, req.user);
  res.status(httpStatus.NO_CONTENT).send();
});

const signOffItem = catchAsync(async (req, res) => {
  const item = await checkpointService.signOffItem(req.params.itemId, req.body, req.user);
  res.send(item);
});

const updateRemark = catchAsync(async (req, res) => {
  const item = await checkpointService.updateRemark(req.params.itemId, req.body, req.user);
  res.send(item);
});

const listItemLogs = catchAsync(async (req, res) => {
  const logs = await checkpointService.listItemLogs(req.params.itemId);
  res.send(logs);
});

export {
  listCheckpoints,
  createModule,
  updateModule,
  deleteModule,
  createItem,
  updateItem,
  deleteItem,
  signOffItem,
  updateRemark,
  listItemLogs,
};
