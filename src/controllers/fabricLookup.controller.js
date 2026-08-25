import httpStatus from 'http-status';
import pick from '../utils/pick.js';
import ApiError from '../utils/ApiError.js';
import catchAsync from '../utils/catchAsync.js';
import * as fabricTypeService from '../services/fabricType.service.js';
import * as fabricColorService from '../services/fabricColor.service.js';
import * as fabricQualityService from '../services/fabricQuality.service.js';
import * as fabricYarnCountService from '../services/fabricYarnCount.service.js';
import * as fabricMeasurementService from '../services/fabricMeasurement.service.js';

const makeListHandler = (serviceFn, filterKeys) =>
  catchAsync(async (req, res) => {
    const filter = pick(req.query, filterKeys);
    const options = pick(req.query, ['sortBy', 'limit', 'page']);
    const result = await serviceFn(filter, options, req.query.search);
    res.send(result);
  });

const makeGetHandler = (serviceFn, label, paramKey) =>
  catchAsync(async (req, res) => {
    const entity = await serviceFn(req.params[paramKey]);
    if (!entity) throw new ApiError(httpStatus.NOT_FOUND, `${label} not found`);
    res.send(entity);
  });

const makeCreateHandler = (serviceFn) =>
  catchAsync(async (req, res) => {
    const entity = await serviceFn(req.body);
    res.status(httpStatus.CREATED).send(entity);
  });

const makeUpdateHandler = (serviceFn, paramKey) =>
  catchAsync(async (req, res) => {
    const entity = await serviceFn(req.params[paramKey], req.body);
    res.send(entity);
  });

const makeDeleteHandler = (serviceFn, paramKey) =>
  catchAsync(async (req, res) => {
    await serviceFn(req.params[paramKey]);
    res.status(httpStatus.NO_CONTENT).send();
  });

export const createFabricType = makeCreateHandler(fabricTypeService.createFabricType);
export const getFabricTypes = makeListHandler(fabricTypeService.queryFabricTypes, ['name', 'status']);
export const getFabricType = makeGetHandler(fabricTypeService.getFabricTypeById, 'Fabric type', 'fabricTypeId');
export const updateFabricType = makeUpdateHandler(fabricTypeService.updateFabricTypeById, 'fabricTypeId');
export const deleteFabricType = makeDeleteHandler(fabricTypeService.deleteFabricTypeById, 'fabricTypeId');

export const createFabricColor = makeCreateHandler(fabricColorService.createFabricColor);
export const getFabricColors = makeListHandler(fabricColorService.queryFabricColors, ['name', 'status']);
export const getFabricColor = makeGetHandler(fabricColorService.getFabricColorById, 'Fabric color', 'fabricColorId');
export const updateFabricColor = makeUpdateHandler(fabricColorService.updateFabricColorById, 'fabricColorId');
export const deleteFabricColor = makeDeleteHandler(fabricColorService.deleteFabricColorById, 'fabricColorId');

export const createFabricQuality = makeCreateHandler(fabricQualityService.createFabricQuality);
export const getFabricQualities = makeListHandler(fabricQualityService.queryFabricQualities, ['name', 'status']);
export const getFabricQuality = makeGetHandler(
  fabricQualityService.getFabricQualityById,
  'Fabric quality',
  'fabricQualityId'
);
export const updateFabricQuality = makeUpdateHandler(fabricQualityService.updateFabricQualityById, 'fabricQualityId');
export const deleteFabricQuality = makeDeleteHandler(fabricQualityService.deleteFabricQualityById, 'fabricQualityId');

export const createFabricYarnCount = makeCreateHandler(fabricYarnCountService.createFabricYarnCount);
export const getFabricYarnCounts = makeListHandler(fabricYarnCountService.queryFabricYarnCounts, ['name', 'status']);
export const getFabricYarnCount = makeGetHandler(
  fabricYarnCountService.getFabricYarnCountById,
  'Fabric yarn/count',
  'fabricYarnCountId'
);
export const updateFabricYarnCount = makeUpdateHandler(
  fabricYarnCountService.updateFabricYarnCountById,
  'fabricYarnCountId'
);
export const deleteFabricYarnCount = makeDeleteHandler(
  fabricYarnCountService.deleteFabricYarnCountById,
  'fabricYarnCountId'
);

export const createFabricMeasurement = makeCreateHandler(fabricMeasurementService.createFabricMeasurement);
export const getFabricMeasurements = makeListHandler(fabricMeasurementService.queryFabricMeasurements, [
  'name',
  'status',
  'category',
]);
export const getFabricMeasurement = makeGetHandler(
  fabricMeasurementService.getFabricMeasurementById,
  'Fabric measurement',
  'fabricMeasurementId'
);
export const updateFabricMeasurement = makeUpdateHandler(
  fabricMeasurementService.updateFabricMeasurementById,
  'fabricMeasurementId'
);
export const deleteFabricMeasurement = makeDeleteHandler(
  fabricMeasurementService.deleteFabricMeasurementById,
  'fabricMeasurementId'
);
