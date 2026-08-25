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
const MODULE = 'Catalog.Fabric Color';

router
  .route('/')
  .post(auth(), requireCrud(MODULE, 'create'), validate(validation.createFabricColor), controller.createFabricColor)
  .get(auth(), fabricMasterRead(MODULE), validate(validation.getFabricColors), controller.getFabricColors);

router
  .route('/:fabricColorId')
  .get(auth(), fabricMasterRead(MODULE), validate(validation.getFabricColor), controller.getFabricColor)
  .patch(auth(), requireCrud(MODULE, 'update'), validate(validation.updateFabricColor), controller.updateFabricColor)
  .delete(auth(), requireCrud(MODULE, 'delete'), validate(validation.deleteFabricColor), controller.deleteFabricColor);

export default router;
