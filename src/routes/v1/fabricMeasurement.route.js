import express from 'express';
import validate from '../../middlewares/validate.js';
import auth from '../../middlewares/auth.js';
import { requireCrud, requireAnyCrudPath } from '../../middlewares/requireCrud.js';
import * as validation from '../../validations/fabricLookup.validation.js';
import * as controller from '../../controllers/fabricLookup.controller.js';

const fabricMasterRead = (modulePath) =>
  requireAnyCrudPath([
    { path: modulePath, action: 'read' },
    { path: 'Catalog.Fabric master', action: 'read' },
    { path: 'Catalog.Items', action: 'read' },
  ]);

const router = express.Router();
const MODULE = 'Catalog.Fabric Measurement';

router
  .route('/')
  .post(
    auth(),
    requireCrud(MODULE, 'create'),
    validate(validation.createFabricMeasurement),
    controller.createFabricMeasurement
  )
  .get(auth(), fabricMasterRead(MODULE), validate(validation.getFabricMeasurements), controller.getFabricMeasurements);

router
  .route('/:fabricMeasurementId')
  .get(auth(), fabricMasterRead(MODULE), validate(validation.getFabricMeasurement), controller.getFabricMeasurement)
  .patch(
    auth(),
    requireCrud(MODULE, 'update'),
    validate(validation.updateFabricMeasurement),
    controller.updateFabricMeasurement
  )
  .delete(
    auth(),
    requireCrud(MODULE, 'delete'),
    validate(validation.deleteFabricMeasurement),
    controller.deleteFabricMeasurement
  );

export default router;
