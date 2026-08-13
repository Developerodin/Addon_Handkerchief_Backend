import express from 'express';
import validate from '../../middlewares/validate.js';
import auth from '../../middlewares/auth.js';
import { requireCrud, itemsReferenceRead } from '../../middlewares/requireCrud.js';
import * as v from '../../validations/phase3Catalog.validation.js';
import {
  machineController,
  workerController,
  storageRackController,
  containerController,
  labelTemplateController,
  deviceRegistryController,
} from '../../controllers/phase3Catalog.controller.js';

const router = express.Router();

const bind = (path, MODULE, validation, controller, idParam) => {
  router
    .route(path)
    .post(auth(), requireCrud(MODULE, 'create'), validate(validation.create), controller.create)
    .get(auth(), itemsReferenceRead(MODULE), validate(validation.list), controller.list);
  router
    .route(`${path}/:${idParam}`)
    .get(auth(), itemsReferenceRead(MODULE), validate(validation.get), controller.get)
    .patch(auth(), requireCrud(MODULE, 'update'), validate(validation.update), controller.update)
    .delete(auth(), requireCrud(MODULE, 'delete'), validate(validation.delete), controller.remove);
};

bind('/machines', 'Catalog.Machines & Configuration', {
  create: v.createMachine,
  list: v.getMachines,
  get: v.getMachine,
  update: v.updateMachine,
  delete: v.deleteMachine,
}, machineController, 'machineId');

bind('/workers', 'Catalog.Workers / Operators', {
  create: v.createWorker,
  list: v.getWorkers,
  get: v.getWorker,
  update: v.updateWorker,
  delete: v.deleteWorker,
}, workerController, 'workerId');

bind('/storage-racks', 'Catalog.Storage Racks', {
  create: v.createStorageRack,
  list: v.getStorageRacks,
  get: v.getStorageRack,
  update: v.updateStorageRack,
  delete: v.deleteStorageRack,
}, storageRackController, 'rackId');

bind('/containers', 'Catalog.Containers Master', {
  create: v.createContainer,
  list: v.getContainers,
  get: v.getContainer,
  update: v.updateContainer,
  delete: v.deleteContainer,
}, containerController, 'containerId');

bind('/label-templates', 'Catalog.Label Templates & Device Registry', {
  create: v.createLabelTemplate,
  list: v.getLabelTemplates,
  get: v.getLabelTemplate,
  update: v.updateLabelTemplate,
  delete: v.deleteLabelTemplate,
}, labelTemplateController, 'templateId');

bind('/device-registry', 'Catalog.Label Templates & Device Registry', {
  create: v.createDeviceRegistry,
  list: v.getDeviceRegistries,
  get: v.getDeviceRegistry,
  update: v.updateDeviceRegistry,
  delete: v.deleteDeviceRegistry,
}, deviceRegistryController, 'deviceId');

export default router;
