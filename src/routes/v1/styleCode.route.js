import express from 'express';
import validate from '../../middlewares/validate.js';
import auth from '../../middlewares/auth.js';
import { requireCrud, requireAnyCrud, itemsReferenceRead } from '../../middlewares/requireCrud.js';
import * as styleCodeValidation from '../../validations/styleCode.validation.js';
import * as styleCodeController from '../../controllers/styleCode.controller.js';

const router = express.Router();
const STYLE_CODES = 'Catalog.Style Codes';

router
  .route('/')
  .post(auth(), requireCrud(STYLE_CODES, 'create'), validate(styleCodeValidation.createStyleCode), styleCodeController.createStyleCode)
  .get(auth(), itemsReferenceRead(STYLE_CODES), validate(styleCodeValidation.getStyleCodes), styleCodeController.getStyleCodes);

router
  .route('/bulk-import')
  .post(auth(), requireAnyCrud(STYLE_CODES, ['create', 'update']), validate(styleCodeValidation.bulkImportStyleCodes), styleCodeController.bulkImportStyleCodes);

router
  .route('/bulk-sync')
  .post(auth(), requireAnyCrud(STYLE_CODES, ['create', 'update']), validate(styleCodeValidation.bulkSyncStyleCodes), styleCodeController.bulkSyncStyleCodes);

router
  .route('/bulk-import-bom')
  .post(auth(), requireAnyCrud(STYLE_CODES, ['create', 'update']), validate(styleCodeValidation.bulkImportBom), styleCodeController.bulkImportBom);

router
  .route('/:styleCodeId')
  .get(auth(), itemsReferenceRead(STYLE_CODES), validate(styleCodeValidation.getStyleCode), styleCodeController.getStyleCode)
  .patch(auth(), requireCrud(STYLE_CODES, 'update'), validate(styleCodeValidation.updateStyleCode), styleCodeController.updateStyleCode)
  .delete(auth(), requireCrud(STYLE_CODES, 'delete'), validate(styleCodeValidation.deleteStyleCode), styleCodeController.deleteStyleCode);

export default router;
