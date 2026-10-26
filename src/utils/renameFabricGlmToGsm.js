import FabricCatalog from '../models/fabricCatalog.model.js';

/**
 * Moves legacy GLM fabric-catalog fields onto GSM keys.
 * Skips documents that already have `gsm` so a later restart does not overwrite it.
 * @returns {Promise<{ matchedCount: number, modifiedCount: number }>}
 */
export const renameFabricGlmFieldsToGsm = async () => {
  const result = await FabricCatalog.collection.updateMany(
    { glm: { $exists: true }, gsm: { $exists: false } },
    {
      $rename: {
        glm: 'gsm',
        glmMeasurement: 'gsmMeasurement',
        glmMeasurementName: 'gsmMeasurementName',
      },
    }
  );

  return {
    matchedCount: result.matchedCount ?? 0,
    modifiedCount: result.modifiedCount ?? 0,
  };
};
