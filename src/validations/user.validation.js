import Joi from 'joi';
import { password, objectId } from './custom.validation.js';

const crudSchema = Joi.object().keys({
  create: Joi.boolean().required(),
  read: Joi.boolean().required(),
  update: Joi.boolean().required(),
  delete: Joi.boolean().required(),
});

const navigationSchema = Joi.object().keys({
  Dashboard: crudSchema,
  Catalog: Joi.object().keys({
    Items: crudSchema,
    Categories: crudSchema,
    'Raw Material': crudSchema,
    Processes: crudSchema,
    Attributes: crudSchema,
    'Style Codes': crudSchema,
  }),
  Users: crudSchema,
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
