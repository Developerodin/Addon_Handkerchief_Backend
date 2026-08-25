import FabricColor from '../models/fabricColor.model.js';
import {
  createLookupEntity,
  queryLookupEntities,
  getLookupEntityById,
  updateLookupEntityById,
  deleteLookupEntityById,
} from '../utils/fabricLookupCrud.js';

const LABEL = 'Fabric color';

export const createFabricColor = (body) =>
  createLookupEntity(FabricColor, body, { entityLabel: LABEL });

export const queryFabricColors = (filter, options, search) =>
  queryLookupEntities(FabricColor, filter, options, search, ['name', 'colorCode', 'pantone']);

export const getFabricColorById = (id) => getLookupEntityById(FabricColor, id);

export const updateFabricColorById = (id, body) =>
  updateLookupEntityById(FabricColor, id, body, { entityLabel: LABEL });

export const deleteFabricColorById = (id) =>
  deleteLookupEntityById(FabricColor, id, LABEL);
