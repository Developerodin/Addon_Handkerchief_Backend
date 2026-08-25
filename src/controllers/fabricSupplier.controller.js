import httpStatus from 'http-status';
import pick from '../utils/pick.js';
import ApiError from '../utils/ApiError.js';
import catchAsync from '../utils/catchAsync.js';
import * as fabricSupplierService from '../services/fabricSupplier.service.js';

export const createFabricSupplier = catchAsync(async (req, res) => {
  const supplier = await fabricSupplierService.createFabricSupplier(req.body);
  res.status(httpStatus.CREATED).send(supplier);
});

export const getFabricSuppliers = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['name', 'status']);
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  const result = await fabricSupplierService.queryFabricSuppliers(filter, options, req.query.search);
  res.send(result);
});

export const getFabricSupplier = catchAsync(async (req, res) => {
  const supplier = await fabricSupplierService.getFabricSupplierById(req.params.supplierId);
  if (!supplier) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Fabric supplier not found');
  }
  res.send(supplier);
});

export const updateFabricSupplier = catchAsync(async (req, res) => {
  const supplier = await fabricSupplierService.updateFabricSupplierById(req.params.supplierId, req.body);
  res.send(supplier);
});

export const deleteFabricSupplier = catchAsync(async (req, res) => {
  await fabricSupplierService.deleteFabricSupplierById(req.params.supplierId);
  res.status(httpStatus.NO_CONTENT).send();
});
