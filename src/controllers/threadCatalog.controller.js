import httpStatus from 'http-status';
import pick from '../utils/pick.js';
import ApiError from '../utils/ApiError.js';
import catchAsync from '../utils/catchAsync.js';
import * as threadCatalogService from '../services/threadCatalog.service.js';

export const createThreadCatalog = catchAsync(async (req, res) => {
  const thread = await threadCatalogService.createThreadCatalog(req.body);
  res.status(httpStatus.CREATED).send(thread);
});

export const getThreadCatalogs = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['threadCode', 'threadType', 'status']);
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  const result = await threadCatalogService.queryThreadCatalogs(filter, options, req.query.search);
  res.send(result);
});

export const getThreadCatalog = catchAsync(async (req, res) => {
  const thread = await threadCatalogService.getThreadCatalogById(req.params.threadId);
  if (!thread) throw new ApiError(httpStatus.NOT_FOUND, 'Thread not found');
  res.send(thread);
});

export const updateThreadCatalog = catchAsync(async (req, res) => {
  const thread = await threadCatalogService.updateThreadCatalogById(req.params.threadId, req.body);
  res.send(thread);
});

export const deleteThreadCatalog = catchAsync(async (req, res) => {
  await threadCatalogService.deleteThreadCatalogById(req.params.threadId);
  res.status(httpStatus.NO_CONTENT).send();
});
