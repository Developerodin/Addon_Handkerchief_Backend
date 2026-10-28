import Joi from 'joi';
import { objectId } from './custom.validation.js';

const createModule = {
  body: Joi.object().keys({
    name: Joi.string().trim().min(1).max(120).required(),
  }),
};

const updateModule = {
  params: Joi.object().keys({
    moduleId: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    name: Joi.string().trim().min(1).max(120).required(),
  }),
};

const moduleIdParam = {
  params: Joi.object().keys({
    moduleId: Joi.string().custom(objectId).required(),
  }),
};

const createItem = {
  params: Joi.object().keys({
    moduleId: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    title: Joi.string().trim().min(1).max(200).required(),
    description: Joi.string().trim().max(2000).allow(''),
  }),
};

const updateItem = {
  params: Joi.object().keys({
    itemId: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    title: Joi.string().trim().min(1).max(200).required(),
    description: Joi.string().trim().max(2000).allow(''),
  }),
};

const itemIdParam = {
  params: Joi.object().keys({
    itemId: Joi.string().custom(objectId).required(),
  }),
};

const signOff = {
  params: Joi.object().keys({
    itemId: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object().keys({
    column: Joi.string().valid('developer', 'addon').required(),
    checked: Joi.boolean().required(),
  }),
};

export { createModule, updateModule, moduleIdParam, createItem, updateItem, itemIdParam, signOff };
