import express from 'express';
import validate from '../../middlewares/validate.js';
import auth from '../../middlewares/auth.js';
import { requireCrud, itemsReferenceRead } from '../../middlewares/requireCrud.js';
import * as threadSupplierValidation from '../../validations/threadSupplier.validation.js';
import * as threadSupplierController from '../../controllers/threadSupplier.controller.js';

const router = express.Router();
const MODULE = 'Catalog.Thread Suppliers';

router
  .route('/')
  .post(auth(), requireCrud(MODULE, 'create'), validate(threadSupplierValidation.createThreadSupplier), threadSupplierController.createThreadSupplier)
  .get(auth(), itemsReferenceRead(MODULE), validate(threadSupplierValidation.getThreadSuppliers), threadSupplierController.getThreadSuppliers);

router
  .route('/:supplierId')
  .get(auth(), itemsReferenceRead(MODULE), validate(threadSupplierValidation.getThreadSupplier), threadSupplierController.getThreadSupplier)
  .patch(auth(), requireCrud(MODULE, 'update'), validate(threadSupplierValidation.updateThreadSupplier), threadSupplierController.updateThreadSupplier)
  .delete(auth(), requireCrud(MODULE, 'delete'), validate(threadSupplierValidation.deleteThreadSupplier), threadSupplierController.deleteThreadSupplier);

export default router;
