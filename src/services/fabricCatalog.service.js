import httpStatus from 'http-status';
import FabricCatalog from '../models/fabricCatalog.model.js';
import FabricType from '../models/fabricType.model.js';
import FabricColor from '../models/fabricColor.model.js';
import FabricQuality from '../models/fabricQuality.model.js';
import FabricYarn from '../models/fabricYarn.model.js';
import FabricCount from '../models/fabricCount.model.js';
import FabricMeasurement from '../models/fabricMeasurement.model.js';
import ProductAttribute from '../models/productAttribute.model.js';
import ApiError from '../utils/ApiError.js';
import { buildFabricCatalogName } from '../utils/fabricCatalogName.util.js';
import { escapeRegex } from '../utils/fabricLookupCrud.js';

const STITCH_TYPE_ATTRIBUTE_NAME = 'stitch type';

const LOOKUP_FIELDS = [
  { idKey: 'fabricType', nameKey: 'fabricTypeName', Model: FabricType, label: 'Fabric type' },
  { idKey: 'color', nameKey: 'colourName', Model: FabricColor, label: 'Fabric color' },
  { idKey: 'quality', nameKey: 'qualityName', Model: FabricQuality, label: 'Fabric quality' },
  { idKey: 'yarn', nameKey: 'yarnName', Model: FabricYarn, label: 'Fabric yarn' },
  { idKey: 'count', nameKey: 'countName', Model: FabricCount, label: 'Fabric count' },
  {
    idKey: 'gsmMeasurement',
    nameKey: 'gsmMeasurementName',
    Model: FabricMeasurement,
    label: 'GSM measurement',
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
  ['fabricType', 'color', 'quality', 'yarn', 'count', 'gsmMeasurement', 'finishedWidthMeasurement'].forEach(
    (key) => {
      if (next[key] === '') next[key] = null;
    }
  );
  if (next.fabricSortNo != null) {
    next.fabricSortNo = String(next.fabricSortNo).trim();
  }
  ['millOldFabricSortNo', 'millNewFabricSortNo'].forEach((key) => {
    if (next[key] != null) {
      next[key] = String(next[key]).trim();
    }
  });
  ['design', 'wash', 'finish', 'stitchType'].forEach((key) => {
    if (next[key] != null) {
      next[key] = String(next[key]).trim();
    }
  });
  return next;
};

const resolveStitchType = async (payload) => {
  const next = { ...payload };
  if (!Object.prototype.hasOwnProperty.call(next, 'stitchType')) return next;

  const raw = next.stitchType == null ? '' : String(next.stitchType).trim();
  if (!raw) {
    next.stitchType = '';
    return next;
  }

  const attribute = await ProductAttribute.findOne({
    name: new RegExp(`^${escapeRegex(STITCH_TYPE_ATTRIBUTE_NAME)}$`, 'i'),
  });
  if (!attribute) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Stitch type attribute not found in attributes master');
  }

  const options = attribute.optionValues || [];
  const byId = options.find((opt) => String(opt._id) === raw);
  if (byId?.name) {
    next.stitchType = byId.name;
    return next;
  }

  const byName = options.find((opt) => (opt.name || '').toLowerCase() === raw.toLowerCase());
  if (byName?.name) {
    next.stitchType = byName.name;
    return next;
  }

  throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid Stitch type');
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
  return resolveStitchType(next);
};

const FABRIC_NAME_LOOKUP_KEYS = ['fabricType', 'color', 'quality', 'yarn', 'count'];

/**
 * Builds the stored fabric name from denormalized lookup names.
 * @param {object} doc
 * @returns {string}
 */
const requireGeneratedFabricName = (doc) => {
  const generated = buildFabricCatalogName(doc);
  if (!generated) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Set at least one of fabric type, color, quality, yarn, or count'
    );
  }
  return generated;
};

const FABRIC_POPULATE = [
  { path: 'fabricType', select: 'name status' },
  { path: 'color', select: 'name colorCode status' },
  { path: 'quality', select: 'name composition primaryFiber primaryFiberPercent secondaryFiber secondaryFiberPercent grade status' },
  { path: 'yarn', select: 'name status' },
  { path: 'count', select: 'name status' },
  { path: 'gsmMeasurement', select: 'name symbol category status' },
  { path: 'finishedWidthMeasurement', select: 'name symbol category status' },
];

export const createFabricCatalog = async (body) => {
  const payload = await resolveLookupNames(normalizeBody(body));
  payload.name = requireGeneratedFabricName(payload);
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
        { millOldFabricSortNo: searchRegex },
        { millNewFabricSortNo: searchRegex },
        { fabricTypeName: searchRegex },
        { colourName: searchRegex },
        { qualityName: searchRegex },
        { yarnName: searchRegex },
        { countName: searchRegex },
        { construction: searchRegex },
        { weave: searchRegex },
        { stitchType: searchRegex },
        { gsmMeasurementName: searchRegex },
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
  delete payload.name;
  const shouldRegenerateName = FABRIC_NAME_LOOKUP_KEYS.some((key) =>
    Object.prototype.hasOwnProperty.call(payload, key)
  );
  if (payload.fabricSortNo) {
    const existing = await FabricCatalog.findOne({
      fabricSortNo: payload.fabricSortNo,
      _id: { $ne: fabricId },
    });
    if (existing) throw new ApiError(httpStatus.BAD_REQUEST, 'Fabric sort number already exists');
  }
  Object.assign(fabric, payload);
  if (shouldRegenerateName) {
    fabric.name = requireGeneratedFabricName(fabric);
  }
  await fabric.save();
  return fabric.populate(FABRIC_POPULATE);
};

export const deleteFabricCatalogById = async (fabricId) => {
  const fabric = await FabricCatalog.findById(fabricId);
  if (!fabric) throw new ApiError(httpStatus.NOT_FOUND, 'Fabric not found');
  await fabric.deleteOne();
  return fabric;
};
