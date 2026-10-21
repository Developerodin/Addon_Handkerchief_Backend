import Joi from 'joi';
import { password, objectId } from './custom.validation.js';

const crudSchema = Joi.object().keys({
  create: Joi.boolean().required(),
  read: Joi.boolean().required(),
  update: Joi.boolean().required(),
  delete: Joi.boolean().required(),
});

const helpSupportSchema = Joi.object().keys({
  enabled: Joi.boolean().required(),
  Files: crudSchema,
  Tasks: crudSchema,
  Tickets: crudSchema,
});

const navigationSchema = Joi.object().keys({
  Dashboard: crudSchema,
  Catalog: Joi.object()
    .keys({
      Items: crudSchema,
      Category: crudSchema,
      'Style codes': crudSchema,
      'Fabric master': crudSchema,
      'Fabric Type': crudSchema,
      'Fabric Color': crudSchema,
      'Fabric Quality': crudSchema,
      'Fabric Yarn': crudSchema,
      'Fabric Count': crudSchema,
      'Fabric Measurement': crudSchema,
      'Fabric Suppliers': crudSchema,
      'Packaging materials': crudSchema,
      'Process Master': crudSchema,
      'Attributes Master': crudSchema,
      // Legacy keys accepted then migrated in service
      Categories: crudSchema,
      'Style Codes': crudSchema,
      'Raw Material': crudSchema,
      Processes: crudSchema,
      Attributes: crudSchema,
    })
    .unknown(true),
  Users: crudSchema,
  'Revision review': crudSchema,
  Sync: crudSchema,
  'Store / Purchase orders': crudSchema,
  'Store / Receipt': crudSchema,
  'Store / Racks and issue': crudSchema,
  'Production / Orders': crudSchema,
  'Production / Floor': crudSchema,
  'Production / Cut': crudSchema,
  'Production / Selvage': crudSchema,
  'Production / Half moon': crudSchema,
  'Production / Vertical hem': crudSchema,
  'Production / Bundle': crudSchema,
  'Production / Horizontal hem': crudSchema,
  'Production / Thread cut': crudSchema,
  'Production / Iron': crudSchema,
  'Production / Route split': crudSchema,
  'Production / Embroidery': crudSchema,
  'Production / Sticker': crudSchema,
  'Quality / Fabric QC': crudSchema,
  'Quality / Floor checks': crudSchema,
  'Quality / Grades': crudSchema,
  'Warehouse / Packing': crudSchema,
  'Warehouse / Boxes': crudSchema,
  'Warehouse / Orders': crudSchema,
  'Warehouse / Dispatch': crudSchema,
  'Accounts / Invoices': crudSchema,
  Reports: crudSchema,
  'Fabric / Purchase orders': crudSchema,
  'Fabric / Drafts': crudSchema,
  'Fabric / Receipts': crudSchema,
  'Fabric / GRN history': crudSchema,
  'Fabric / Vendor return': crudSchema,
  'Fabric / Return challan': crudSchema,
  'Fabric / Issue': crudSchema,
  'Fabric / Return': crudSchema,
  'Fabric / Storage': crudSchema,
  'Fabric / Live inventory': crudSchema,
  'Fabric / Stock report': crudSchema,
  'Fabric / PO analytics': crudSchema,
  'Fabric / Fabric analytics': crudSchema,
  'Help & Support': helpSupportSchema,
});

const createUser = {
  body: Joi.object().keys({
    email: Joi.string().required().email(),
    password: Joi.string().required().custom(password),
    name: Joi.string().required(),
    role: Joi.string().required().valid('user', 'accounts', 'admin', 'super_admin'),
    phoneNumber: Joi.string().allow('', null),
    profilePicture: Joi.string().allow('', null),
    navigation: navigationSchema,
  }),
};

const getUsers = {
  query: Joi.object().keys({
    name: Joi.string(),
    role: Joi.string(),
    search: Joi.string(),
    sortBy: Joi.string(),
    limit: Joi.number().integer(),
    page: Joi.number().integer(),
  }),
};

const getUser = {
  params: Joi.object().keys({
    userId: Joi.string().custom(objectId),
  }),
};

const updateUser = {
  params: Joi.object().keys({
    userId: Joi.required().custom(objectId),
  }),
  body: Joi.object()
    .keys({
      email: Joi.string().email(),
      password: Joi.string().custom(password),
      name: Joi.string(),
      role: Joi.string().valid('user', 'accounts', 'admin', 'super_admin'),
      phoneNumber: Joi.string().allow('', null),
      profilePicture: Joi.string().allow('', null),
      navigation: navigationSchema,
    })
    .min(1),
};

const updateUserNavigation = {
  params: Joi.object().keys({
    userId: Joi.required().custom(objectId),
  }),
  body: Joi.object().keys({
    navigation: navigationSchema.required(),
  }),
};

const deleteUser = {
  params: Joi.object().keys({
    userId: Joi.string().custom(objectId),
  }),
};

export { createUser, getUsers, getUser, updateUser, updateUserNavigation, deleteUser };
