import Joi from 'joi';
import { objectId } from './custom.validation.js';

const componentSchema = Joi.object().keys({
  styleCode: Joi.string().custom(objectId).required(),
  quantity: Joi.number().integer().min(1).required(),
});

export const createStyleCodeCombo = {
  body: Joi.object().keys({
    comboCode: Joi.string().required(),
    eanCode: Joi.string().required(),
    mrp: Joi.number().min(0).required(),
    brand: Joi.string().allow(''),
    pack: Joi.string().allow(''),
    components: Joi.array().items(componentSchema).min(1).required(),
    status: Joi.string().valid('active', 'inactive'),
  }),
};

export const getStyleCodeCombos = {
  query: Joi.object().keys({
    comboCode: Joi.string(),
    eanCode: Joi.string(),
    status: Joi.string(),
    search: Joi.string(),
    sortBy: Joi.string(),
    limit: Joi.number().integer(),
    page: Joi.number().integer(),
  }),
};

export const getStyleCodeCombo = {
  params: Joi.object().keys({
    comboId: Joi.string().custom(objectId),
  }),
};

export const updateStyleCodeCombo = {
  params: Joi.object().keys({
    comboId: Joi.string().custom(objectId),
  }),
  body: Joi.object()
    .keys({
      comboCode: Joi.string(),
      eanCode: Joi.string(),
      mrp: Joi.number().min(0),
      brand: Joi.string().allow(''),
      pack: Joi.string().allow(''),
      components: Joi.array().items(componentSchema).min(1),
      status: Joi.string().valid('active', 'inactive'),
    })
    .min(1),
};

export const deleteStyleCodeCombo = {
  params: Joi.object().keys({
    comboId: Joi.string().custom(objectId),
  }),
};
