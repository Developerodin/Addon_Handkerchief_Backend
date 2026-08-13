import express from 'express';
import validate from '../../middlewares/validate.js';
import auth from '../../middlewares/auth.js';
import { requireCrud, itemsReferenceRead } from '../../middlewares/requireCrud.js';
import * as fabricSupplierValidation from '../../validations/fabricSupplier.validation.js';
import * as fabricSupplierController from '../../controllers/fabricSupplier.controller.js';

const router = express.Router();
const MODULE = 'Catalog.Fabric Suppliers';

router
  .route('/')
  .post(auth(), requireCrud(MODULE, 'create'), validate(fabricSupplierValidation.createFabricSupplier), fabricSupplierController.createFabricSupplier)
  .get(auth(), itemsReferenceRead(MODULE), validate(fabricSupplierValidation.getFabricSuppliers), fabricSupplierController.getFabricSuppliers);

router
  .route('/:supplierId')
  .get(auth(), itemsReferenceRead(MODULE), validate(fabricSupplierValidation.getFabricSupplier), fabricSupplierController.getFabricSupplier)
  .patch(auth(), requireCrud(MODULE, 'update'), validate(fabricSupplierValidation.updateFabricSupplier), fabricSupplierController.updateFabricSupplier)
  .delete(auth(), requireCrud(MODULE, 'delete'), validate(fabricSupplierValidation.deleteFabricSupplier), fabricSupplierController.deleteFabricSupplier);

export default router;
