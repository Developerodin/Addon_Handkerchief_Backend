import Joi from 'joi';
import { objectId } from './custom.validation.js';

const bankDetails = Joi.object().keys({
  bankName: Joi.string().allow(''),
  accountHolder: Joi.string().allow(''),
  accountNumber: Joi.string().allow(''),
  ifsc: Joi.string().allow(''),
});

const threadDetail = Joi.object().keys({
  threadCatalogId: Joi.string().custom(objectId).required(),
  threadCode: Joi.string().allow(''),
  threadType: Joi.string().allow(''),
});

export const createThreadSupplier = {
  body: Joi.object().keys({
    name: Joi.string().required(),
    contactPerson: Joi.string().required(),
    contactNumber: Joi.string().allow(''),
    email: Joi.string().email().allow(''),
    address: Joi.string().required(),
    city: Joi.string().allow(''),
    state: Joi.string().allow(''),
    pincode: Joi.string().allow(''),
    country: Joi.string().allow(''),
    gstin: Joi.string().allow(''),
    paymentTerms: Joi.string().allow(''),
    threadDetails: Joi.array().items(threadDetail),
    bankDetails,
    status: Joi.string().valid('active', 'inactive'),
  }),
};

export const getThreadSuppliers = {
  query: Joi.object().keys({
    name: Joi.string(),
    status: Joi.string(),
    search: Joi.string(),
    sortBy: Joi.string(),
    limit: Joi.number().integer(),
    page: Joi.number().integer(),
  }),
};

export const getThreadSupplier = {
  params: Joi.object().keys({
    supplierId: Joi.string().custom(objectId),
  }),
};

export const updateThreadSupplier = {
  params: Joi.object().keys({
    supplierId: Joi.string().custom(objectId),
  }),
  body: Joi.object()
    .keys({
      name: Joi.string(),
      contactPerson: Joi.string(),
      contactNumber: Joi.string().allow(''),
      email: Joi.string().email().allow(''),
      address: Joi.string(),
      city: Joi.string().allow(''),
      state: Joi.string().allow(''),
      pincode: Joi.string().allow(''),
      country: Joi.string().allow(''),
      gstin: Joi.string().allow(''),
      paymentTerms: Joi.string().allow(''),
      threadDetails: Joi.array().items(threadDetail),
      bankDetails,
      status: Joi.string().valid('active', 'inactive'),
    })
    .min(1),
};

export const deleteThreadSupplier = {
  params: Joi.object().keys({
    supplierId: Joi.string().custom(objectId),
  }),
};
