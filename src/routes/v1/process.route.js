import express from 'express';
import validate from '../../middlewares/validate.js';
import auth from '../../middlewares/auth.js';
import { requireCrud, itemsReferenceRead } from '../../middlewares/requireCrud.js';
import * as processValidation from '../../validations/process.validation.js';
import * as processController from '../../controllers/process.controller.js';

const router = express.Router();
const PROCESSES = 'Catalog.Processes';

router
  .route('/')
  .post(auth(), requireCrud(PROCESSES, 'create'), validate(processValidation.createProcess), processController.createProcess)
  .get(auth(), itemsReferenceRead(PROCESSES), validate(processValidation.getProcesses), processController.getProcesses);

router
  .route('/:processId')
  .get(auth(), itemsReferenceRead(PROCESSES), validate(processValidation.getProcess), processController.getProcess)
  .patch(auth(), requireCrud(PROCESSES, 'update'), validate(processValidation.updateProcess), processController.updateProcess)
  .delete(auth(), requireCrud(PROCESSES, 'delete'), validate(processValidation.deleteProcess), processController.deleteProcess);

export default router;
