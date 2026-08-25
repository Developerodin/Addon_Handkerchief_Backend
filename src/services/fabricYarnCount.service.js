import FabricYarnCount from '../models/fabricYarnCount.model.js';
import {
  createLookupEntity,
  queryLookupEntities,
  getLookupEntityById,
  updateLookupEntityById,
  deleteLookupEntityById,
} from '../utils/fabricLookupCrud.js';

const LABEL = 'Fabric yarn/count';

export const createFabricYarnCount = (body) =>
  createLookupEntity(FabricYarnCount, body, { entityLabel: LABEL });

export const queryFabricYarnCounts = (filter, options, search) =>
  queryLookupEntities(FabricYarnCount, filter, options, search, ['name']);

export const getFabricYarnCountById = (id) => getLookupEntityById(FabricYarnCount, id);

export const updateFabricYarnCountById = (id, body) =>
  updateLookupEntityById(FabricYarnCount, id, body, { entityLabel: LABEL });

export const deleteFabricYarnCountById = (id) =>
  deleteLookupEntityById(FabricYarnCount, id, LABEL);
