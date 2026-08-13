import Machine from '../models/machine.model.js';
import Worker from '../models/worker.model.js';
import StorageRack from '../models/storageRack.model.js';
import Container from '../models/container.model.js';
import LabelTemplate from '../models/labelTemplate.model.js';
import DeviceRegistry from '../models/deviceRegistry.model.js';
import { createCatalogCrud } from '../utils/catalogCrud.js';

export const machineService = createCatalogCrud(Machine, {
  resourceName: 'Machine',
  uniqueField: 'code',
  populate: 'assignedSupervisor',
  searchFields: ['name', 'code', 'machineType', 'makeModel', 'department', 'floor', 'maintenanceNotes'],
});

export const workerService = createCatalogCrud(Worker, {
  resourceName: 'Worker',
  uniqueField: 'employeeCode',
  populate: 'supervisor',
  searchFields: ['name', 'employeeCode', 'department', 'skill', 'shift', 'contactNumber', 'barcode'],
});

export const storageRackService = createCatalogCrud(StorageRack, {
  resourceName: 'Storage rack',
  uniqueField: 'code',
  searchFields: ['code', 'name', 'floor', 'zone', 'stockType', 'barcode'],
});

export const containerService = createCatalogCrud(Container, {
  resourceName: 'Container',
  uniqueField: 'code',
  searchFields: ['code', 'name', 'type', 'barcode', 'department', 'floor'],
});

export const labelTemplateService = createCatalogCrud(LabelTemplate, {
  resourceName: 'Label template',
  populate: 'printerDevice',
  searchFields: ['name', 'labelType', 'size', 'barcodeScheme'],
});

export const deviceRegistryService = createCatalogCrud(DeviceRegistry, {
  resourceName: 'Device',
  searchFields: ['name', 'deviceType', 'model', 'location', 'labelSize', 'scannerType'],
});
