import FabricQuality from '../models/fabricQuality.model.js';
import {
  createLookupEntity,
  queryLookupEntities,
  getLookupEntityById,
  updateLookupEntityById,
  deleteLookupEntityById,
} from '../utils/fabricLookupCrud.js';

const LABEL = 'Fabric quality';

export const createFabricQuality = (body) =>
  createLookupEntity(FabricQuality, body, { entityLabel: LABEL });

export const queryFabricQualities = (filter, options, search) =>
  queryLookupEntities(FabricQuality, filter, options, search, [
    'name',
    'composition',
    'primaryFiber',
    'secondaryFiber',
    'grade',
  ]);

export const getFabricQualityById = (id) => getLookupEntityById(FabricQuality, id);

export const updateFabricQualityById = (id, body) =>
  updateLookupEntityById(FabricQuality, id, body, { entityLabel: LABEL });

export const deleteFabricQualityById = (id) =>
  deleteLookupEntityById(FabricQuality, id, LABEL);
