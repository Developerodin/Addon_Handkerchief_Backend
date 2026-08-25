import Joi from 'joi';
import { objectId } from './custom.validation.js';

const lookupId = Joi.string().custom(objectId).allow(null, '');

const fabricCatalogBody = {
  name: Joi.string(),
  fabricSortNo: Joi.string().allow(''),
  fabricType: lookupId,
  color: lookupId,
  quality: lookupId,
  yarnCount: lookupId,
  construction: Joi.string().allow(''),
  weave: Joi.string().allow(''),
  glm: Joi.number().min(0),
  glmMeasurement: lookupId,
  finishedWidth: Joi.number().min(0),
  finishedWidthMeasurement: lookupId,
  rate: Joi.number().min(0),
  gst: Joi.string().allow(''),
  hsnCode: Joi.string().allow(''),
  minQuantity: Joi.number().min(0),
  status: Joi.string().valid('active', 'inactive'),
  remark: Joi.string().allow(''),
};

export const createFabricCatalog = {
  body: Joi.object().keys({
    name: Joi.string().required(),
    ...fabricCatalogBody,
  }),
};

export const getFabricCatalogs = {
  query: Joi.object().keys({
    name: Joi.string(),
    fabricSortNo: Joi.string(),
    fabricType: Joi.string().custom(objectId),
    color: Joi.string().custom(objectId),
    quality: Joi.string().custom(objectId),
    status: Joi.string(),
    search: Joi.string(),
    sortBy: Joi.string(),
    limit: Joi.number().integer(),
    page: Joi.number().integer(),
  }),
};

export const getFabricCatalog = {
  params: Joi.object().keys({
    fabricId: Joi.string().custom(objectId),
  }),
};

export const updateFabricCatalog = {
  params: Joi.object().keys({
    fabricId: Joi.string().custom(objectId),
  }),
  body: Joi.object().keys(fabricCatalogBody).min(1),
};

export const deleteFabricCatalog = {
  params: Joi.object().keys({
    fabricId: Joi.string().custom(objectId),
  }),
};
