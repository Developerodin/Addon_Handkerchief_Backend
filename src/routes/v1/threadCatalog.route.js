import express from 'express';
import validate from '../../middlewares/validate.js';
import auth from '../../middlewares/auth.js';
import { requireCrud, itemsReferenceRead } from '../../middlewares/requireCrud.js';
import * as threadCatalogValidation from '../../validations/threadCatalog.validation.js';
import * as threadCatalogController from '../../controllers/threadCatalog.controller.js';

const router = express.Router();
const MODULE = 'Catalog.Thread Catalog';

router
  .route('/')
  .post(auth(), requireCrud(MODULE, 'create'), validate(threadCatalogValidation.createThreadCatalog), threadCatalogController.createThreadCatalog)
  .get(auth(), itemsReferenceRead(MODULE), validate(threadCatalogValidation.getThreadCatalogs), threadCatalogController.getThreadCatalogs);

router
  .route('/:threadId')
  .get(auth(), itemsReferenceRead(MODULE), validate(threadCatalogValidation.getThreadCatalog), threadCatalogController.getThreadCatalog)
  .patch(auth(), requireCrud(MODULE, 'update'), validate(threadCatalogValidation.updateThreadCatalog), threadCatalogController.updateThreadCatalog)
  .delete(auth(), requireCrud(MODULE, 'delete'), validate(threadCatalogValidation.deleteThreadCatalog), threadCatalogController.deleteThreadCatalog);

export default router;
