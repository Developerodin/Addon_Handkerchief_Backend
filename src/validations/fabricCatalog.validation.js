import Joi from 'joi';
import { objectId } from './custom.validation.js';

export const createFabricCatalog = {
  body: Joi.object().keys({
    name: Joi.string().required(),
    code: Joi.string().allow(''),
    fabricType: Joi.string().allow(''),
    composition: Joi.string().allow(''),
    gsm: Joi.number().min(0),
    width: Joi.number().min(0),
    colour: Joi.string().allow(''),
    shade: Joi.string().allow(''),
    pantone: Joi.string().allow(''),
    design: Joi.string().allow(''),
    rate: Joi.number().min(0),
    gst: Joi.string().allow(''),
    hsnCode: Joi.string().allow(''),
    minQuantity: Joi.number().min(0),
    supplier: Joi.string().custom(objectId).allow(null, ''),
    supplierName: Joi.string().allow(''),
    uomRolls: Joi.boolean(),
    uomKg: Joi.boolean(),
    uomMetres: Joi.boolean(),
    status: Joi.string().valid('active', 'inactive'),
    remark: Joi.string().allow(''),
  }),
};

export const getFabricCatalogs = {
  query: Joi.object().keys({
    name: Joi.string(),
    code: Joi.string(),
    fabricType: Joi.string(),
    colour: Joi.string(),
    status: Joi.string(),
    supplier: Joi.string().custom(objectId),
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
  body: Joi.object()
    .keys({
      name: Joi.string(),
      code: Joi.string().allow(''),
      fabricType: Joi.string().allow(''),
      composition: Joi.string().allow(''),
      gsm: Joi.number().min(0),
      width: Joi.number().min(0),
      colour: Joi.string().allow(''),
      shade: Joi.string().allow(''),
      pantone: Joi.string().allow(''),
      design: Joi.string().allow(''),
      rate: Joi.number().min(0),
      gst: Joi.string().allow(''),
      hsnCode: Joi.string().allow(''),
      minQuantity: Joi.number().min(0),
      supplier: Joi.string().custom(objectId).allow(null, ''),
      supplierName: Joi.string().allow(''),
      uomRolls: Joi.boolean(),
      uomKg: Joi.boolean(),
      uomMetres: Joi.boolean(),
      status: Joi.string().valid('active', 'inactive'),
      remark: Joi.string().allow(''),
    })
    .min(1),
};

export const deleteFabricCatalog = {
  params: Joi.object().keys({
    fabricId: Joi.string().custom(objectId),
  }),
};
