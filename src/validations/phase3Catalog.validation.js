import Joi from 'joi';
import { objectId } from './custom.validation.js';
import { PROCESS_DEPARTMENTS, PROCESS_MACHINE_TYPES } from '../models/process.model.js';
import { STOCK_TYPES } from '../models/storageRack.model.js';
import { CONTAINER_TYPES } from '../models/container.model.js';
import { LABEL_TYPES } from '../models/labelTemplate.model.js';

const machineTypes = PROCESS_MACHINE_TYPES.filter((t) => t !== 'none');

export const createMachine = {
  body: Joi.object().keys({
    name: Joi.string().required(),
    code: Joi.string().allow(''),
    machineType: Joi.string().valid(...machineTypes, '').allow(''),
    makeModel: Joi.string().allow(''),
    department: Joi.string().valid(...PROCESS_DEPARTMENTS, '').allow(''),
    floor: Joi.string().allow(''),
    capacityPerShift: Joi.number().min(0),
    maintenanceIntervalMonths: Joi.number().min(0),
    lastMaintenanceDate: Joi.date().allow(null),
    nextMaintenanceDate: Joi.date().allow(null),
    maintenanceNotes: Joi.string().allow(''),
    assignedSupervisor: Joi.string().custom(objectId).allow(null, ''),
    status: Joi.string().valid('active', 'inactive'),
  }),
};

export const getMachines = {
  query: Joi.object().keys({
    name: Joi.string(), code: Joi.string(), machineType: Joi.string(), department: Joi.string(), status: Joi.string(),
    search: Joi.string(), sortBy: Joi.string(), limit: Joi.number().integer(), page: Joi.number().integer(),
  }),
};

export const getMachine = { params: Joi.object().keys({ machineId: Joi.string().custom(objectId) }) };

export const updateMachine = {
  params: Joi.object().keys({ machineId: Joi.string().custom(objectId) }),
  body: Joi.object()
    .keys({
      name: Joi.string(),
      code: Joi.string().allow(''),
      machineType: Joi.string().valid(...machineTypes, '').allow(''),
      makeModel: Joi.string().allow(''),
      department: Joi.string().valid(...PROCESS_DEPARTMENTS, '').allow(''),
      floor: Joi.string().allow(''),
      capacityPerShift: Joi.number().min(0),
      maintenanceIntervalMonths: Joi.number().min(0),
      lastMaintenanceDate: Joi.date().allow(null),
      nextMaintenanceDate: Joi.date().allow(null),
      maintenanceNotes: Joi.string().allow(''),
      assignedSupervisor: Joi.string().custom(objectId).allow(null, ''),
      status: Joi.string().valid('active', 'inactive'),
    })
    .min(1),
};

export const deleteMachine = { params: Joi.object().keys({ machineId: Joi.string().custom(objectId) }) };

export const createWorker = {
  body: Joi.object().keys({
    name: Joi.string().required(),
    employeeCode: Joi.string().required(),
    department: Joi.string().valid(...PROCESS_DEPARTMENTS, '').allow(''),
    supervisor: Joi.string().custom(objectId).allow(null, ''),
    skill: Joi.string().allow(''),
    shift: Joi.string().allow(''),
    contactNumber: Joi.string().allow(''),
    barcode: Joi.string().allow(''),
    joinDate: Joi.date().allow(null),
    status: Joi.string().valid('active', 'inactive'),
  }),
};

export const getWorkers = {
  query: Joi.object().keys({
    name: Joi.string(), employeeCode: Joi.string(), department: Joi.string(), status: Joi.string(),
    search: Joi.string(), sortBy: Joi.string(), limit: Joi.number().integer(), page: Joi.number().integer(),
  }),
};

export const getWorker = { params: Joi.object().keys({ workerId: Joi.string().custom(objectId) }) };

export const updateWorker = {
  params: Joi.object().keys({ workerId: Joi.string().custom(objectId) }),
  body: Joi.object()
    .keys({
      name: Joi.string(),
      employeeCode: Joi.string(),
      department: Joi.string().valid(...PROCESS_DEPARTMENTS, '').allow(''),
      supervisor: Joi.string().custom(objectId).allow(null, ''),
      skill: Joi.string().allow(''),
      shift: Joi.string().allow(''),
      contactNumber: Joi.string().allow(''),
      barcode: Joi.string().allow(''),
      joinDate: Joi.date().allow(null),
      status: Joi.string().valid('active', 'inactive'),
    })
    .min(1),
};

export const deleteWorker = { params: Joi.object().keys({ workerId: Joi.string().custom(objectId) }) };

export const createStorageRack = {
  body: Joi.object().keys({
    code: Joi.string().required(),
    name: Joi.string().required(),
    floor: Joi.string().allow(''),
    zone: Joi.string().allow(''),
    stockType: Joi.string().valid(...STOCK_TYPES),
    capacity: Joi.number().min(0),
    barcode: Joi.string().allow(''),
    status: Joi.string().valid('active', 'inactive'),
  }),
};

export const getStorageRacks = {
  query: Joi.object().keys({
    code: Joi.string(), name: Joi.string(), stockType: Joi.string(), status: Joi.string(),
    search: Joi.string(), sortBy: Joi.string(), limit: Joi.number().integer(), page: Joi.number().integer(),
  }),
};

export const getStorageRack = { params: Joi.object().keys({ rackId: Joi.string().custom(objectId) }) };

export const updateStorageRack = {
  params: Joi.object().keys({ rackId: Joi.string().custom(objectId) }),
  body: Joi.object()
    .keys({
      code: Joi.string(),
      name: Joi.string(),
      floor: Joi.string().allow(''),
      zone: Joi.string().allow(''),
      stockType: Joi.string().valid(...STOCK_TYPES),
      capacity: Joi.number().min(0),
      barcode: Joi.string().allow(''),
      status: Joi.string().valid('active', 'inactive'),
    })
    .min(1),
};

export const deleteStorageRack = { params: Joi.object().keys({ rackId: Joi.string().custom(objectId) }) };

export const createContainer = {
  body: Joi.object().keys({
    code: Joi.string().required(),
    name: Joi.string().required(),
    type: Joi.string().valid(...CONTAINER_TYPES),
    capacity: Joi.number().min(0),
    barcode: Joi.string().allow(''),
    department: Joi.string().valid(...PROCESS_DEPARTMENTS, '').allow(''),
    floor: Joi.string().allow(''),
    reusable: Joi.boolean(),
    status: Joi.string().valid('active', 'inactive'),
  }),
};

export const getContainers = {
  query: Joi.object().keys({
    code: Joi.string(), name: Joi.string(), type: Joi.string(), status: Joi.string(),
    search: Joi.string(), sortBy: Joi.string(), limit: Joi.number().integer(), page: Joi.number().integer(),
  }),
};

export const getContainer = { params: Joi.object().keys({ containerId: Joi.string().custom(objectId) }) };

export const updateContainer = {
  params: Joi.object().keys({ containerId: Joi.string().custom(objectId) }),
  body: Joi.object()
    .keys({
      code: Joi.string(),
      name: Joi.string(),
      type: Joi.string().valid(...CONTAINER_TYPES),
      capacity: Joi.number().min(0),
      barcode: Joi.string().allow(''),
      department: Joi.string().valid(...PROCESS_DEPARTMENTS, '').allow(''),
      floor: Joi.string().allow(''),
      reusable: Joi.boolean(),
      status: Joi.string().valid('active', 'inactive'),
    })
    .min(1),
};

export const deleteContainer = { params: Joi.object().keys({ containerId: Joi.string().custom(objectId) }) };

export const createLabelTemplate = {
  body: Joi.object().keys({
    name: Joi.string().required(),
    labelType: Joi.string().valid(...LABEL_TYPES).required(),
    size: Joi.string().allow(''),
    encodedFields: Joi.array().items(Joi.string()),
    barcodeScheme: Joi.string().allow(''),
    printerDevice: Joi.string().custom(objectId).allow(null, ''),
    status: Joi.string().valid('active', 'inactive'),
  }),
};

export const getLabelTemplates = {
  query: Joi.object().keys({
    name: Joi.string(), labelType: Joi.string(), status: Joi.string(),
    search: Joi.string(), sortBy: Joi.string(), limit: Joi.number().integer(), page: Joi.number().integer(),
  }),
};

export const getLabelTemplate = { params: Joi.object().keys({ templateId: Joi.string().custom(objectId) }) };

export const updateLabelTemplate = {
  params: Joi.object().keys({ templateId: Joi.string().custom(objectId) }),
  body: Joi.object()
    .keys({
      name: Joi.string(),
      labelType: Joi.string().valid(...LABEL_TYPES),
      size: Joi.string().allow(''),
      encodedFields: Joi.array().items(Joi.string()),
      barcodeScheme: Joi.string().allow(''),
      printerDevice: Joi.string().custom(objectId).allow(null, ''),
      status: Joi.string().valid('active', 'inactive'),
    })
    .min(1),
};

export const deleteLabelTemplate = { params: Joi.object().keys({ templateId: Joi.string().custom(objectId) }) };

export const createDeviceRegistry = {
  body: Joi.object().keys({
    name: Joi.string().required(),
    deviceType: Joi.string().valid('printer', 'scanner').required(),
    model: Joi.string().allow(''),
    location: Joi.string().allow(''),
    labelSize: Joi.string().allow(''),
    scannerType: Joi.string().valid('handheld', 'fixed', '').allow(''),
    status: Joi.string().valid('active', 'inactive'),
  }),
};

export const getDeviceRegistries = {
  query: Joi.object().keys({
    name: Joi.string(), deviceType: Joi.string(), status: Joi.string(),
    search: Joi.string(), sortBy: Joi.string(), limit: Joi.number().integer(), page: Joi.number().integer(),
  }),
};

export const getDeviceRegistry = { params: Joi.object().keys({ deviceId: Joi.string().custom(objectId) }) };

export const updateDeviceRegistry = {
  params: Joi.object().keys({ deviceId: Joi.string().custom(objectId) }),
  body: Joi.object()
    .keys({
      name: Joi.string(),
      deviceType: Joi.string().valid('printer', 'scanner'),
      model: Joi.string().allow(''),
      location: Joi.string().allow(''),
      labelSize: Joi.string().allow(''),
      scannerType: Joi.string().valid('handheld', 'fixed', '').allow(''),
      status: Joi.string().valid('active', 'inactive'),
    })
    .min(1),
};

export const deleteDeviceRegistry = { params: Joi.object().keys({ deviceId: Joi.string().custom(objectId) }) };
