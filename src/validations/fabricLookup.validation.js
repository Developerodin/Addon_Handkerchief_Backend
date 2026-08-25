import Joi from 'joi';
import { objectId } from './custom.validation.js';
import { MEASUREMENT_CATEGORIES } from '../models/fabricMeasurement.model.js';

const statusField = Joi.string().valid('active', 'inactive');

const listQuery = {
  name: Joi.string(),
  status: Joi.string(),
  search: Joi.string(),
  sortBy: Joi.string(),
  limit: Joi.number().integer(),
  page: Joi.number().integer(),
};

export const createFabricType = {
  body: Joi.object().keys({
    name: Joi.string().required(),
    status: statusField,
  }),
};

export const getFabricTypes = { query: Joi.object().keys(listQuery) };

export const getFabricType = {
  params: Joi.object().keys({ fabricTypeId: Joi.string().custom(objectId) }),
};

export const updateFabricType = {
  params: Joi.object().keys({ fabricTypeId: Joi.string().custom(objectId) }),
  body: Joi.object()
    .keys({
      name: Joi.string(),
      status: statusField,
    })
    .min(1),
};

export const deleteFabricType = {
  params: Joi.object().keys({ fabricTypeId: Joi.string().custom(objectId) }),
};

export const createFabricColor = {
  body: Joi.object().keys({
    name: Joi.string().required(),
    colorCode: Joi.string().required(),
    pantone: Joi.string().allow(''),
    status: statusField,
  }),
};

export const getFabricColors = { query: Joi.object().keys(listQuery) };

export const getFabricColor = {
  params: Joi.object().keys({ fabricColorId: Joi.string().custom(objectId) }),
};

export const updateFabricColor = {
  params: Joi.object().keys({ fabricColorId: Joi.string().custom(objectId) }),
  body: Joi.object()
    .keys({
      name: Joi.string(),
      colorCode: Joi.string(),
      pantone: Joi.string().allow(''),
      status: statusField,
    })
    .min(1),
};

export const deleteFabricColor = {
  params: Joi.object().keys({ fabricColorId: Joi.string().custom(objectId) }),
};

export const createFabricQuality = {
  body: Joi.object().keys({
    name: Joi.string().required(),
    composition: Joi.string().allow(''),
    primaryFiber: Joi.string().allow(''),
    primaryFiberPercent: Joi.number().min(0).max(100).allow(null),
    secondaryFiber: Joi.string().allow(''),
    secondaryFiberPercent: Joi.number().min(0).max(100).allow(null),
    grade: Joi.string().allow(''),
    remarks: Joi.string().allow(''),
    status: statusField,
  }),
};

export const getFabricQualities = { query: Joi.object().keys(listQuery) };

export const getFabricQuality = {
  params: Joi.object().keys({ fabricQualityId: Joi.string().custom(objectId) }),
};

export const updateFabricQuality = {
  params: Joi.object().keys({ fabricQualityId: Joi.string().custom(objectId) }),
  body: Joi.object()
    .keys({
      name: Joi.string(),
      composition: Joi.string().allow(''),
      primaryFiber: Joi.string().allow(''),
      primaryFiberPercent: Joi.number().min(0).max(100).allow(null),
      secondaryFiber: Joi.string().allow(''),
      secondaryFiberPercent: Joi.number().min(0).max(100).allow(null),
      grade: Joi.string().allow(''),
      remarks: Joi.string().allow(''),
      status: statusField,
    })
    .min(1),
};

export const deleteFabricQuality = {
  params: Joi.object().keys({ fabricQualityId: Joi.string().custom(objectId) }),
};

export const createFabricYarnCount = {
  body: Joi.object().keys({
    name: Joi.string().required(),
    status: statusField,
  }),
};

export const getFabricYarnCounts = { query: Joi.object().keys(listQuery) };

export const getFabricYarnCount = {
  params: Joi.object().keys({ fabricYarnCountId: Joi.string().custom(objectId) }),
};

export const updateFabricYarnCount = {
  params: Joi.object().keys({ fabricYarnCountId: Joi.string().custom(objectId) }),
  body: Joi.object()
    .keys({
      name: Joi.string(),
      status: statusField,
    })
    .min(1),
};

export const deleteFabricYarnCount = {
  params: Joi.object().keys({ fabricYarnCountId: Joi.string().custom(objectId) }),
};

export const createFabricMeasurement = {
  body: Joi.object().keys({
    name: Joi.string().required(),
    symbol: Joi.string().allow(''),
    category: Joi.string()
      .valid(...MEASUREMENT_CATEGORIES)
      .required(),
    status: statusField,
  }),
};

export const getFabricMeasurements = {
  query: Joi.object().keys({
    ...listQuery,
    category: Joi.string().valid(...MEASUREMENT_CATEGORIES),
  }),
};

export const getFabricMeasurement = {
  params: Joi.object().keys({ fabricMeasurementId: Joi.string().custom(objectId) }),
};

export const updateFabricMeasurement = {
  params: Joi.object().keys({ fabricMeasurementId: Joi.string().custom(objectId) }),
  body: Joi.object()
    .keys({
      name: Joi.string(),
      symbol: Joi.string().allow(''),
      category: Joi.string().valid(...MEASUREMENT_CATEGORIES),
      status: statusField,
    })
    .min(1),
};

export const deleteFabricMeasurement = {
  params: Joi.object().keys({ fabricMeasurementId: Joi.string().custom(objectId) }),
};
