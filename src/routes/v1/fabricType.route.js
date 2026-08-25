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
const MODULE = 'Catalog.Fabric Type';

router
  .route('/')
  .post(auth(), requireCrud(MODULE, 'create'), validate(validation.createFabricType), controller.createFabricType)
  .get(auth(), fabricMasterRead(MODULE), validate(validation.getFabricTypes), controller.getFabricTypes);

router
  .route('/:fabricTypeId')
  .get(auth(), fabricMasterRead(MODULE), validate(validation.getFabricType), controller.getFabricType)
  .patch(auth(), requireCrud(MODULE, 'update'), validate(validation.updateFabricType), controller.updateFabricType)
  .delete(auth(), requireCrud(MODULE, 'delete'), validate(validation.deleteFabricType), controller.deleteFabricType);

export default router;
