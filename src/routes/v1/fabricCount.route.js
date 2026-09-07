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
const MODULE = 'Catalog.Fabric Count';

router
  .route('/')
  .post(auth(), requireCrud(MODULE, 'create'), validate(validation.createFabricCount), controller.createFabricCount)
  .get(auth(), fabricMasterRead(MODULE), validate(validation.getFabricCounts), controller.getFabricCounts);

router
  .route('/:fabricCountId')
  .get(auth(), fabricMasterRead(MODULE), validate(validation.getFabricCount), controller.getFabricCount)
  .patch(auth(), requireCrud(MODULE, 'update'), validate(validation.updateFabricCount), controller.updateFabricCount)
  .delete(auth(), requireCrud(MODULE, 'delete'), validate(validation.deleteFabricCount), controller.deleteFabricCount);

export default router;
