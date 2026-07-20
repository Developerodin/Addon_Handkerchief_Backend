import express from 'express';
import validate from '../../middlewares/validate.js';
import auth from '../../middlewares/auth.js';
import { requireCrud, itemsReferenceRead } from '../../middlewares/requireCrud.js';
import rawMaterialValidation from '../../validations/rawMaterial.validation.js';
import rawMaterialController from '../../controllers/rawMaterial.controller.js';

const router = express.Router();
const RAW_MATERIAL = 'Catalog.Raw Material';

router
  .route('/')
  .post(auth(), requireCrud(RAW_MATERIAL, 'create'), validate(rawMaterialValidation.createRawMaterial), rawMaterialController.createRawMaterial)
  .get(auth(), itemsReferenceRead(RAW_MATERIAL), validate(rawMaterialValidation.getRawMaterials), rawMaterialController.getRawMaterials);

router
  .route('/:materialId')
  .get(auth(), itemsReferenceRead(RAW_MATERIAL), validate(rawMaterialValidation.getRawMaterial), rawMaterialController.getRawMaterial)
  .patch(auth(), requireCrud(RAW_MATERIAL, 'update'), validate(rawMaterialValidation.updateRawMaterial), rawMaterialController.updateRawMaterial)
  .delete(auth(), requireCrud(RAW_MATERIAL, 'delete'), validate(rawMaterialValidation.deleteRawMaterial), rawMaterialController.deleteRawMaterial);

export default router;
