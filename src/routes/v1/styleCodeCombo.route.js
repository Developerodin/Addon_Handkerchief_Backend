import express from 'express';
import validate from '../../middlewares/validate.js';
import auth from '../../middlewares/auth.js';
import { requireCrud, itemsReferenceRead } from '../../middlewares/requireCrud.js';
import * as styleCodeComboValidation from '../../validations/styleCodeCombo.validation.js';
import * as styleCodeComboController from '../../controllers/styleCodeCombo.controller.js';

const router = express.Router();
const MODULE = 'Catalog.Style codes';

router
  .route('/')
  .post(auth(), requireCrud(MODULE, 'create'), validate(styleCodeComboValidation.createStyleCodeCombo), styleCodeComboController.createStyleCodeCombo)
  .get(auth(), itemsReferenceRead(MODULE), validate(styleCodeComboValidation.getStyleCodeCombos), styleCodeComboController.getStyleCodeCombos);

router
  .route('/:comboId')
  .get(auth(), itemsReferenceRead(MODULE), validate(styleCodeComboValidation.getStyleCodeCombo), styleCodeComboController.getStyleCodeCombo)
  .patch(auth(), requireCrud(MODULE, 'update'), validate(styleCodeComboValidation.updateStyleCodeCombo), styleCodeComboController.updateStyleCodeCombo)
  .delete(auth(), requireCrud(MODULE, 'delete'), validate(styleCodeComboValidation.deleteStyleCodeCombo), styleCodeComboController.deleteStyleCodeCombo);

export default router;
