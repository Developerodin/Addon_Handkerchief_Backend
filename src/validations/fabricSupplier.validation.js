import Joi from 'joi';
import { objectId } from './custom.validation.js';

const bankDetails = Joi.object().keys({
  bankName: Joi.string().allow(''),
  accountHolder: Joi.string().allow(''),
  accountNumber: Joi.string().allow(''),
  ifsc: Joi.string().allow(''),
});

export const createFabricSupplier = {
  body: Joi.object().keys({
    name: Joi.string().required(),
    code: Joi.string().allow(''),
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
    leadTimeDays: Joi.number().integer().min(0),
    bankDetails,
    status: Joi.string().valid('active', 'inactive'),
  }),
};

export const getFabricSuppliers = {
  query: Joi.object().keys({
    name: Joi.string(),
    code: Joi.string(),
    status: Joi.string(),
    search: Joi.string(),
    sortBy: Joi.string(),
    limit: Joi.number().integer(),
    page: Joi.number().integer(),
  }),
};

export const getFabricSupplier = {
  params: Joi.object().keys({
    supplierId: Joi.string().custom(objectId),
  }),
};

export const updateFabricSupplier = {
  params: Joi.object().keys({
    supplierId: Joi.string().custom(objectId),
  }),
  body: Joi.object()
    .keys({
      name: Joi.string(),
      code: Joi.string().allow(''),
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
      leadTimeDays: Joi.number().integer().min(0),
      bankDetails,
      status: Joi.string().valid('active', 'inactive'),
    })
    .min(1),
};

export const deleteFabricSupplier = {
  params: Joi.object().keys({
    supplierId: Joi.string().custom(objectId),
  }),
};
