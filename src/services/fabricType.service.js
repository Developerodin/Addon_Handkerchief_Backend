import FabricType from '../models/fabricType.model.js';
import {
  createLookupEntity,
  queryLookupEntities,
  getLookupEntityById,
  updateLookupEntityById,
  deleteLookupEntityById,
} from '../utils/fabricLookupCrud.js';

const LABEL = 'Fabric type';

export const createFabricType = (body) =>
  createLookupEntity(FabricType, body, { entityLabel: LABEL });

export const queryFabricTypes = (filter, options, search) =>
  queryLookupEntities(FabricType, filter, options, search, ['name']);

export const getFabricTypeById = (id) => getLookupEntityById(FabricType, id);

export const updateFabricTypeById = (id, body) =>
  updateLookupEntityById(FabricType, id, body, { entityLabel: LABEL });

export const deleteFabricTypeById = (id) =>
  deleteLookupEntityById(FabricType, id, LABEL);
