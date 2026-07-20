import express from 'express';
import validate from '../../middlewares/validate.js';
import auth from '../../middlewares/auth.js';
import { requireCrud, itemsReferenceRead } from '../../middlewares/requireCrud.js';
import productAttributeValidation from '../../validations/productAttribute.validation.js';
import productAttributeController from '../../controllers/productAttribute.controller.js';

const router = express.Router();
const ATTRIBUTES = 'Catalog.Attributes';

router
  .route('/')
  .post(auth(), requireCrud(ATTRIBUTES, 'create'), validate(productAttributeValidation.createProductAttribute), productAttributeController.createProductAttribute)
  .get(auth(), itemsReferenceRead(ATTRIBUTES), validate(productAttributeValidation.getProductAttributes), productAttributeController.getProductAttributes);

router
  .route('/:attributeId')
  .get(auth(), itemsReferenceRead(ATTRIBUTES), validate(productAttributeValidation.getProductAttribute), productAttributeController.getProductAttribute)
  .patch(auth(), requireCrud(ATTRIBUTES, 'update'), validate(productAttributeValidation.updateProductAttribute), productAttributeController.updateProductAttribute)
  .delete(auth(), requireCrud(ATTRIBUTES, 'delete'), validate(productAttributeValidation.deleteProductAttribute), productAttributeController.deleteProductAttribute);

export default router;
