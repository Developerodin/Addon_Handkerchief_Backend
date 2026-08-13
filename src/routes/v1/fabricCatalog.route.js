import express from 'express';
import validate from '../../middlewares/validate.js';
import auth from '../../middlewares/auth.js';
import { requireCrud, itemsReferenceRead } from '../../middlewares/requireCrud.js';
import * as fabricCatalogValidation from '../../validations/fabricCatalog.validation.js';
import * as fabricCatalogController from '../../controllers/fabricCatalog.controller.js';

const router = express.Router();
const MODULE = 'Catalog.Fabric master';

router
  .route('/')
  .post(auth(), requireCrud(MODULE, 'create'), validate(fabricCatalogValidation.createFabricCatalog), fabricCatalogController.createFabricCatalog)
  .get(auth(), itemsReferenceRead(MODULE), validate(fabricCatalogValidation.getFabricCatalogs), fabricCatalogController.getFabricCatalogs);

router
  .route('/:fabricId')
  .get(auth(), itemsReferenceRead(MODULE), validate(fabricCatalogValidation.getFabricCatalog), fabricCatalogController.getFabricCatalog)
  .patch(auth(), requireCrud(MODULE, 'update'), validate(fabricCatalogValidation.updateFabricCatalog), fabricCatalogController.updateFabricCatalog)
  .delete(auth(), requireCrud(MODULE, 'delete'), validate(fabricCatalogValidation.deleteFabricCatalog), fabricCatalogController.deleteFabricCatalog);

export default router;
