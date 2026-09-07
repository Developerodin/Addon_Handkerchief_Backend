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
const MODULE = 'Catalog.Fabric Yarn';

router
  .route('/')
  .post(auth(), requireCrud(MODULE, 'create'), validate(validation.createFabricYarn), controller.createFabricYarn)
  .get(auth(), fabricMasterRead(MODULE), validate(validation.getFabricYarns), controller.getFabricYarns);

router
  .route('/:fabricYarnId')
  .get(auth(), fabricMasterRead(MODULE), validate(validation.getFabricYarn), controller.getFabricYarn)
  .patch(auth(), requireCrud(MODULE, 'update'), validate(validation.updateFabricYarn), controller.updateFabricYarn)
  .delete(auth(), requireCrud(MODULE, 'delete'), validate(validation.deleteFabricYarn), controller.deleteFabricYarn);

export default router;
