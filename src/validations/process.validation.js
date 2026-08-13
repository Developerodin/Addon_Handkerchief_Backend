import Joi from 'joi';
import { objectId } from './custom.validation.js';
import { PROCESS_DEPARTMENTS, PROCESS_MACHINE_TYPES } from '../models/process.model.js';

const processStepSchema = Joi.object().keys({
  stepTitle: Joi.string().required(),
  stepDescription: Joi.string().required(),
  duration: Joi.number().required().min(0),
  _id: Joi.string().custom(objectId),
});

export const createProcess = {
  body: Joi.object().keys({
    name: Joi.string().required(),
    code: Joi.string().allow(''),
    type: Joi.string().required(),
    description: Joi.string().required(),
    department: Joi.string().valid(...PROCESS_DEPARTMENTS, '').allow(''),
    floor: Joi.string().allow(''),
    standardTime: Joi.number().min(0),
    machineType: Joi.string().valid(...PROCESS_MACHINE_TYPES, '').allow(''),
    standardRate: Joi.number().min(0),
    qcCheckpoint: Joi.boolean(),
    reworkEligible: Joi.boolean(),
    sortOrder: Joi.number().integer(),
    status: Joi.string().valid('active', 'inactive'),
    image: Joi.string(),
    steps: Joi.array().items(processStepSchema).min(1).required(),
  }),
};

export const getProcesses = {
  query: Joi.object().keys({
    name: Joi.string(),
    code: Joi.string(),
    type: Joi.string(),
    department: Joi.string(),
    status: Joi.string(),
    search: Joi.string(),
    sortBy: Joi.string(),
    limit: Joi.number().integer(),
    page: Joi.number().integer(),
  }),
};

export const getProcess = {
  params: Joi.object().keys({
    processId: Joi.string().custom(objectId),
  }),
};

export const updateProcess = {
  params: Joi.object().keys({
    processId: Joi.string().custom(objectId),
  }),
  body: Joi.object()
    .keys({
      name: Joi.string(),
      code: Joi.string().allow(''),
      type: Joi.string(),
      description: Joi.string(),
      department: Joi.string().valid(...PROCESS_DEPARTMENTS, '').allow(''),
      floor: Joi.string().allow(''),
      standardTime: Joi.number().min(0),
      machineType: Joi.string().valid(...PROCESS_MACHINE_TYPES, '').allow(''),
      standardRate: Joi.number().min(0),
      qcCheckpoint: Joi.boolean(),
      reworkEligible: Joi.boolean(),
      sortOrder: Joi.number().integer(),
      status: Joi.string().valid('active', 'inactive'),
      image: Joi.string(),
      steps: Joi.array().items(processStepSchema).min(1),
    })
    .min(1),
};

export const deleteProcess = {
  params: Joi.object().keys({
    processId: Joi.string().custom(objectId),
  }),
};
