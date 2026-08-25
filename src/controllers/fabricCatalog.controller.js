import httpStatus from 'http-status';
import pick from '../utils/pick.js';
import ApiError from '../utils/ApiError.js';
import catchAsync from '../utils/catchAsync.js';
import * as fabricCatalogService from '../services/fabricCatalog.service.js';

export const createFabricCatalog = catchAsync(async (req, res) => {
  const fabric = await fabricCatalogService.createFabricCatalog(req.body);
  res.status(httpStatus.CREATED).send(fabric);
});

export const getFabricCatalogs = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['name', 'fabricSortNo', 'fabricType', 'color', 'quality', 'status']);
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  const result = await fabricCatalogService.queryFabricCatalogs(filter, options, req.query.search);
  res.send(result);
});

export const getFabricCatalog = catchAsync(async (req, res) => {
  const fabric = await fabricCatalogService.getFabricCatalogById(req.params.fabricId);
  if (!fabric) throw new ApiError(httpStatus.NOT_FOUND, 'Fabric not found');
  res.send(fabric);
});

export const updateFabricCatalog = catchAsync(async (req, res) => {
  const fabric = await fabricCatalogService.updateFabricCatalogById(req.params.fabricId, req.body);
  res.send(fabric);
});

export const deleteFabricCatalog = catchAsync(async (req, res) => {
  await fabricCatalogService.deleteFabricCatalogById(req.params.fabricId);
  res.status(httpStatus.NO_CONTENT).send();
});
