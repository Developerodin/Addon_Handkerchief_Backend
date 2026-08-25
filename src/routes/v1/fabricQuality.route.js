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
const MODULE = 'Catalog.Fabric Quality';

router
  .route('/')
  .post(auth(), requireCrud(MODULE, 'create'), validate(validation.createFabricQuality), controller.createFabricQuality)
  .get(auth(), fabricMasterRead(MODULE), validate(validation.getFabricQualities), controller.getFabricQualities);

router
  .route('/:fabricQualityId')
  .get(auth(), fabricMasterRead(MODULE), validate(validation.getFabricQuality), controller.getFabricQuality)
  .patch(auth(), requireCrud(MODULE, 'update'), validate(validation.updateFabricQuality), controller.updateFabricQuality)
  .delete(auth(), requireCrud(MODULE, 'delete'), validate(validation.deleteFabricQuality), controller.deleteFabricQuality);

export default router;
