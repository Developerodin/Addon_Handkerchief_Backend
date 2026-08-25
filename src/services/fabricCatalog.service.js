import httpStatus from 'http-status';
import FabricCatalog from '../models/fabricCatalog.model.js';
import FabricType from '../models/fabricType.model.js';
import FabricColor from '../models/fabricColor.model.js';
import FabricQuality from '../models/fabricQuality.model.js';
import FabricYarnCount from '../models/fabricYarnCount.model.js';
import FabricMeasurement from '../models/fabricMeasurement.model.js';
import ApiError from '../utils/ApiError.js';
import { escapeRegex } from '../utils/fabricLookupCrud.js';

const LOOKUP_FIELDS = [
  { idKey: 'fabricType', nameKey: 'fabricTypeName', Model: FabricType, label: 'Fabric type' },
  { idKey: 'color', nameKey: 'colourName', Model: FabricColor, label: 'Fabric color' },
  { idKey: 'quality', nameKey: 'qualityName', Model: FabricQuality, label: 'Fabric quality' },
  { idKey: 'yarnCount', nameKey: 'yarnCountName', Model: FabricYarnCount, label: 'Fabric yarn/count' },
  {
    idKey: 'glmMeasurement',
    nameKey: 'glmMeasurementName',
    Model: FabricMeasurement,
    label: 'GLM measurement',
    category: 'weight',
  },
  {
    idKey: 'finishedWidthMeasurement',
    nameKey: 'finishedWidthMeasurementName',
    Model: FabricMeasurement,
    label: 'Finished width measurement',
    category: 'length',
  },
];

const normalizeBody = (body) => {
  if (!body) return body;
  const next = { ...body };
  ['fabricType', 'color', 'quality', 'yarnCount', 'glmMeasurement', 'finishedWidthMeasurement'].forEach(
    (key) => {
      if (next[key] === '') next[key] = null;
    }
  );
  if (next.fabricSortNo != null) {
    next.fabricSortNo = String(next.fabricSortNo).trim();
  }
  return next;
};

const resolveLookupNames = async (payload) => {
  const next = { ...payload };
  for (const field of LOOKUP_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(next, field.idKey)) continue;
    const value = next[field.idKey];
    if (!value) {
      next[field.nameKey] = '';
      continue;
    }
    const doc = await field.Model.findById(value);
    if (!doc) {
      throw new ApiError(httpStatus.BAD_REQUEST, `${field.label} not found`);
    }
    if (field.category && doc.category !== field.category) {
      throw new ApiError(httpStatus.BAD_REQUEST, `${field.label} must be a ${field.category} unit`);
    }
    next[field.nameKey] = doc.name || '';
  }
  return next;
};

const FABRIC_POPULATE = [
  { path: 'fabricType', select: 'name status' },
  { path: 'color', select: 'name colorCode status' },
  { path: 'quality', select: 'name composition primaryFiber primaryFiberPercent secondaryFiber secondaryFiberPercent grade status' },
  { path: 'yarnCount', select: 'name status' },
  { path: 'glmMeasurement', select: 'name symbol category status' },
  { path: 'finishedWidthMeasurement', select: 'name symbol category status' },
];

export const createFabricCatalog = async (body) => {
  const payload = await resolveLookupNames(normalizeBody(body));
  if (payload.fabricSortNo) {
    const existing = await FabricCatalog.findOne({ fabricSortNo: payload.fabricSortNo });
    if (existing) throw new ApiError(httpStatus.BAD_REQUEST, 'Fabric sort number already exists');
  }
  const fabric = await FabricCatalog.create(payload);
  return fabric.populate(FABRIC_POPULATE);
};

export const queryFabricCatalogs = async (filter, options, search) => {
  let queryFilter = { ...filter };
  if (search && typeof search === 'string' && search.trim()) {
    const searchRegex = new RegExp(escapeRegex(search.trim()), 'i');
    const searchFilter = {
      $or: [
        { name: searchRegex },
        { fabricSortNo: searchRegex },
        { fabricTypeName: searchRegex },
        { colourName: searchRegex },
        { qualityName: searchRegex },
        { yarnCountName: searchRegex },
        { construction: searchRegex },
        { weave: searchRegex },
        { glmMeasurementName: searchRegex },
        { finishedWidthMeasurementName: searchRegex },
        { hsnCode: searchRegex },
        { remark: searchRegex },
      ],
    };
    queryFilter = Object.keys(queryFilter).length ? { $and: [queryFilter, searchFilter] } : searchFilter;
  }
  const queryOptions = { ...options };
  if (!queryOptions.populate) queryOptions.populate = FABRIC_POPULATE;
  return FabricCatalog.paginate(queryFilter, queryOptions);
};

export const getFabricCatalogById = async (id) => FabricCatalog.findById(id).populate(FABRIC_POPULATE);

export const updateFabricCatalogById = async (fabricId, updateBody) => {
  const fabric = await FabricCatalog.findById(fabricId);
  if (!fabric) throw new ApiError(httpStatus.NOT_FOUND, 'Fabric not found');
  const payload = await resolveLookupNames(normalizeBody(updateBody));
  if (payload.fabricSortNo) {
    const existing = await FabricCatalog.findOne({
      fabricSortNo: payload.fabricSortNo,
      _id: { $ne: fabricId },
    });
    if (existing) throw new ApiError(httpStatus.BAD_REQUEST, 'Fabric sort number already exists');
  }
  Object.assign(fabric, payload);
  await fabric.save();
  return fabric.populate(FABRIC_POPULATE);
};

export const deleteFabricCatalogById = async (fabricId) => {
  const fabric = await FabricCatalog.findById(fabricId);
  if (!fabric) throw new ApiError(httpStatus.NOT_FOUND, 'Fabric not found');
  await fabric.deleteOne();
  return fabric;
};
