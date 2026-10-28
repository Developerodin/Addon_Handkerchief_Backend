import express from 'express';
import auth from '../../middlewares/auth.js';
import validate from '../../middlewares/validate.js';
import * as checkpointValidation from '../../validations/checkpoint.validation.js';
import * as checkpointController from '../../controllers/checkpoint.controller.js';

const router = express.Router();

router.get('/', auth(), checkpointController.listCheckpoints);

router.post(
  '/modules',
  auth(),
  validate(checkpointValidation.createModule),
  checkpointController.createModule
);

router
  .route('/modules/:moduleId')
  .patch(auth(), validate(checkpointValidation.updateModule), checkpointController.updateModule)
  .delete(auth(), validate(checkpointValidation.moduleIdParam), checkpointController.deleteModule);

router.post(
  '/modules/:moduleId/items',
  auth(),
  validate(checkpointValidation.createItem),
  checkpointController.createItem
);

router.patch(
  '/items/:itemId/signoff',
  auth(),
  validate(checkpointValidation.signOff),
  checkpointController.signOffItem
);

router.get(
  '/items/:itemId/logs',
  auth(),
  validate(checkpointValidation.itemIdParam),
  checkpointController.listItemLogs
);

router
  .route('/items/:itemId')
  .patch(auth(), validate(checkpointValidation.updateItem), checkpointController.updateItem)
  .delete(auth(), validate(checkpointValidation.itemIdParam), checkpointController.deleteItem);

export default router;
