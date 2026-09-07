import FabricCount from '../models/fabricCount.model.js';
import {
  createLookupEntity,
  queryLookupEntities,
  getLookupEntityById,
  updateLookupEntityById,
  deleteLookupEntityById,
} from '../utils/fabricLookupCrud.js';

const LABEL = 'Fabric count';

export const createFabricCount = (body) =>
  createLookupEntity(FabricCount, body, { entityLabel: LABEL });

export const queryFabricCounts = (filter, options, search) =>
  queryLookupEntities(FabricCount, filter, options, search, ['name']);

export const getFabricCountById = (id) => getLookupEntityById(FabricCount, id);

export const updateFabricCountById = (id, body) =>
  updateLookupEntityById(FabricCount, id, body, { entityLabel: LABEL });

export const deleteFabricCountById = (id) => deleteLookupEntityById(FabricCount, id, LABEL);
