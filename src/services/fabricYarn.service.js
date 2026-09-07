import FabricYarn from '../models/fabricYarn.model.js';
import {
  createLookupEntity,
  queryLookupEntities,
  getLookupEntityById,
  updateLookupEntityById,
  deleteLookupEntityById,
} from '../utils/fabricLookupCrud.js';

const LABEL = 'Fabric yarn';

export const createFabricYarn = (body) =>
  createLookupEntity(FabricYarn, body, { entityLabel: LABEL });

export const queryFabricYarns = (filter, options, search) =>
  queryLookupEntities(FabricYarn, filter, options, search, ['name']);

export const getFabricYarnById = (id) => getLookupEntityById(FabricYarn, id);

export const updateFabricYarnById = (id, body) =>
  updateLookupEntityById(FabricYarn, id, body, { entityLabel: LABEL });

export const deleteFabricYarnById = (id) => deleteLookupEntityById(FabricYarn, id, LABEL);
