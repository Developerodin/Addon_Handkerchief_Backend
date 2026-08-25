import FabricMeasurement from '../models/fabricMeasurement.model.js';
import {
  createLookupEntity,
  queryLookupEntities,
  getLookupEntityById,
  updateLookupEntityById,
  deleteLookupEntityById,
} from '../utils/fabricLookupCrud.js';
import { ensureFabricMeasurementsSeeded } from '../utils/fabricMeasurementSeed.js';

const LABEL = 'Fabric measurement';

export const createFabricMeasurement = async (body) => {
  await ensureFabricMeasurementsSeeded();
  return createLookupEntity(FabricMeasurement, body, { entityLabel: LABEL });
};

export const queryFabricMeasurements = async (filter, options, search) => {
  await ensureFabricMeasurementsSeeded();
  return queryLookupEntities(FabricMeasurement, filter, options, search, ['name', 'symbol']);
};

export const getFabricMeasurementById = async (id) => {
  await ensureFabricMeasurementsSeeded();
  return getLookupEntityById(FabricMeasurement, id);
};

export const updateFabricMeasurementById = async (id, body) => {
  await ensureFabricMeasurementsSeeded();
  return updateLookupEntityById(FabricMeasurement, id, body, { entityLabel: LABEL });
};

export const deleteFabricMeasurementById = async (id) => {
  await ensureFabricMeasurementsSeeded();
  return deleteLookupEntityById(FabricMeasurement, id, LABEL);
};
