import Joi from 'joi';
import { objectId } from './custom.validation.js';

export const createThreadCatalog = {
  body: Joi.object().keys({
    threadCode: Joi.string().trim().min(1).required(),
    threadType: Joi.string().trim().min(1).required(),
    status: Joi.string().valid('active', 'inactive'),
  }),
};

export const getThreadCatalogs = {
  query: Joi.object().keys({
    threadCode: Joi.string(),
    threadType: Joi.string(),
    status: Joi.string(),
    search: Joi.string(),
    sortBy: Joi.string(),
    limit: Joi.number().integer(),
    page: Joi.number().integer(),
  }),
};

export const getThreadCatalog = {
  params: Joi.object().keys({
    threadId: Joi.string().custom(objectId),
  }),
};

export const updateThreadCatalog = {
  params: Joi.object().keys({
    threadId: Joi.string().custom(objectId),
  }),
  body: Joi.object()
    .keys({
      threadCode: Joi.string().trim().min(1),
      threadType: Joi.string().trim().min(1),
      status: Joi.string().valid('active', 'inactive'),
    })
    .min(1),
};

export const deleteThreadCatalog = {
  params: Joi.object().keys({
    threadId: Joi.string().custom(objectId),
  }),
};
