import Joi from 'joi';
import { objectId } from './custom.validation.js';
import { PACKAGING_TYPES } from '../models/rawMaterial.model.js';

const createRawMaterial = {
  body: Joi.object().keys({
    name: Joi.string().required(),
    type: Joi.string().required(),
    sizeSpec: Joi.string().allow(''),
    unit: Joi.string().required(),
    supplier: Joi.string().custom(objectId).allow(null, ''),
    supplierName: Joi.string().allow(''),
    rate: Joi.number().min(0),
    hsnCode: Joi.string().allow(''),
    gst: Joi.string().allow(''),
    minimumStock: Joi.number().min(0),
    description: Joi.string().allow(''),
    status: Joi.string().valid('active', 'inactive'),
    image: Joi.string().allow(null, ''),
    // Legacy optional
    groupName: Joi.string().allow(''),
    brand: Joi.string().allow(''),
    countSize: Joi.string().allow(''),
    material: Joi.string().allow(''),
    color: Joi.string().allow(''),
    shade: Joi.string().allow(''),
    mrp: Joi.string().allow(''),
    articleNo: Joi.string().allow(''),
  }),
};

const getRawMaterials = {
  query: Joi.object().keys({
    name: Joi.string(),
    type: Joi.string(),
    unit: Joi.string(),
    status: Joi.string(),
    supplier: Joi.string().custom(objectId),
    search: Joi.string(),
    sortBy: Joi.string(),
    limit: Joi.number().integer(),
    page: Joi.number().integer(),
  }),
};

const getRawMaterial = {
  params: Joi.object().keys({
    materialId: Joi.string().custom(objectId),
  }),
};

const updateRawMaterial = {
  params: Joi.object().keys({
    materialId: Joi.required().custom(objectId),
  }),
  body: Joi.object()
    .keys({
      name: Joi.string(),
      type: Joi.string(),
      sizeSpec: Joi.string().allow(''),
      unit: Joi.string(),
      supplier: Joi.string().custom(objectId).allow(null, ''),
      supplierName: Joi.string().allow(''),
      rate: Joi.number().min(0),
      hsnCode: Joi.string().allow(''),
      gst: Joi.string().allow(''),
      minimumStock: Joi.number().min(0),
      description: Joi.string().allow(''),
      status: Joi.string().valid('active', 'inactive'),
      image: Joi.string().allow(null, ''),
      groupName: Joi.string().allow(''),
      brand: Joi.string().allow(''),
      countSize: Joi.string().allow(''),
      material: Joi.string().allow(''),
      color: Joi.string().allow(''),
      shade: Joi.string().allow(''),
      mrp: Joi.string().allow(''),
      articleNo: Joi.string().allow(''),
    })
    .min(1),
};

const deleteRawMaterial = {
  params: Joi.object().keys({
    materialId: Joi.string().custom(objectId),
  }),
};

export default {
  createRawMaterial,
  getRawMaterials,
  getRawMaterial,
  updateRawMaterial,
  deleteRawMaterial,
  PACKAGING_TYPES,
};
