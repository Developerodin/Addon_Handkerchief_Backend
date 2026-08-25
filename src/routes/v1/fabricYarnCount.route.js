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
const MODULE = 'Catalog.Fabric Yarn/Count';

router
  .route('/')
  .post(auth(), requireCrud(MODULE, 'create'), validate(validation.createFabricYarnCount), controller.createFabricYarnCount)
  .get(auth(), fabricMasterRead(MODULE), validate(validation.getFabricYarnCounts), controller.getFabricYarnCounts);

router
  .route('/:fabricYarnCountId')
  .get(auth(), fabricMasterRead(MODULE), validate(validation.getFabricYarnCount), controller.getFabricYarnCount)
  .patch(auth(), requireCrud(MODULE, 'update'), validate(validation.updateFabricYarnCount), controller.updateFabricYarnCount)
  .delete(auth(), requireCrud(MODULE, 'delete'), validate(validation.deleteFabricYarnCount), controller.deleteFabricYarnCount);

export default router;
