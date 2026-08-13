import httpStatus from 'http-status';
import pick from '../utils/pick.js';
import ApiError from '../utils/ApiError.js';
import catchAsync from '../utils/catchAsync.js';
import {
  machineService,
  workerService,
  storageRackService,
  containerService,
  labelTemplateService,
  deviceRegistryService,
} from '../services/phase3Catalog.service.js';

const makeHandlers = (service, idParam) => ({
  create: catchAsync(async (req, res) => {
    const doc = await service.create(req.body);
    res.status(httpStatus.CREATED).send(doc);
  }),
  list: catchAsync(async (req, res) => {
    const filter = pick(req.query, Object.keys(req.query).filter((k) => !['search', 'sortBy', 'limit', 'page'].includes(k)));
    const options = pick(req.query, ['sortBy', 'limit', 'page']);
    res.send(await service.query(filter, options, req.query.search));
  }),
  get: catchAsync(async (req, res) => {
    const doc = await service.getById(req.params[idParam]);
    if (!doc) throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
    res.send(doc);
  }),
  update: catchAsync(async (req, res) => {
    res.send(await service.updateById(req.params[idParam], req.body));
  }),
  remove: catchAsync(async (req, res) => {
    await service.deleteById(req.params[idParam]);
    res.status(httpStatus.NO_CONTENT).send();
  }),
});

export const machineController = makeHandlers(machineService, 'machineId');
export const workerController = makeHandlers(workerService, 'workerId');
export const storageRackController = makeHandlers(storageRackService, 'rackId');
export const containerController = makeHandlers(containerService, 'containerId');
export const labelTemplateController = makeHandlers(labelTemplateService, 'templateId');
export const deviceRegistryController = makeHandlers(deviceRegistryService, 'deviceId');
