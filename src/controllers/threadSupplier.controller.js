import httpStatus from 'http-status';
import pick from '../utils/pick.js';
import ApiError from '../utils/ApiError.js';
import catchAsync from '../utils/catchAsync.js';
import * as threadSupplierService from '../services/threadSupplier.service.js';

export const createThreadSupplier = catchAsync(async (req, res) => {
  const supplier = await threadSupplierService.createThreadSupplier(req.body);
  res.status(httpStatus.CREATED).send(supplier);
});

export const getThreadSuppliers = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['name', 'status']);
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  const result = await threadSupplierService.queryThreadSuppliers(filter, options, req.query.search);
  res.send(result);
});

export const getThreadSupplier = catchAsync(async (req, res) => {
  const supplier = await threadSupplierService.getThreadSupplierById(req.params.supplierId);
  if (!supplier) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Thread supplier not found');
  }
  res.send(supplier);
});

export const updateThreadSupplier = catchAsync(async (req, res) => {
  const supplier = await threadSupplierService.updateThreadSupplierById(req.params.supplierId, req.body);
  res.send(supplier);
});

export const deleteThreadSupplier = catchAsync(async (req, res) => {
  await threadSupplierService.deleteThreadSupplierById(req.params.supplierId);
  res.status(httpStatus.NO_CONTENT).send();
});
