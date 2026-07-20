import express from 'express';
import validate from '../../middlewares/validate.js';
import auth from '../../middlewares/auth.js';
import { requireCrud, itemsReferenceRead } from '../../middlewares/requireCrud.js';
import * as categoryValidation from '../../validations/category.validation.js';
import * as categoryController from '../../controllers/category.controller.js';

const router = express.Router();
const CATEGORIES = 'Catalog.Categories';

router
  .route('/')
  .post(auth(), requireCrud(CATEGORIES, 'create'), validate(categoryValidation.createCategory), categoryController.createCategory)
  .get(auth(), itemsReferenceRead(CATEGORIES), validate(categoryValidation.getCategories), categoryController.getCategories);

router
  .route('/:categoryId')
  .get(auth(), itemsReferenceRead(CATEGORIES), validate(categoryValidation.getCategory), categoryController.getCategory)
  .patch(auth(), requireCrud(CATEGORIES, 'update'), validate(categoryValidation.updateCategory), categoryController.updateCategory)
  .delete(auth(), requireCrud(CATEGORIES, 'delete'), validate(categoryValidation.deleteCategory), categoryController.deleteCategory);

export default router;
