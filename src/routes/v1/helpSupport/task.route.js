import express from 'express';
import auth from '../../../middlewares/auth.js';
import validate from '../../../middlewares/validate.js';
import * as taskValidation from '../../../validations/helpSupport/task.validation.js';
import * as taskController from '../../../controllers/helpSupport/task.controller.js';

import * as taskTeamController from '../../../controllers/helpSupport/taskTeam.controller.js';

const router = express.Router();

router
  .route('/teams')
  .get(auth('getHelpSupportHub'), taskTeamController.listTeams)
  .post(auth('manageHelpSupportTasks'), validate(taskValidation.createTeam), taskTeamController.createTeam);

router.patch(
  '/teams/:teamId',
  auth('manageHelpSupportTasks'),
  validate(taskValidation.updateTeam),
  taskTeamController.updateTeam
);

router
  .route('/')
  .post(auth('manageHelpSupportTasks'), validate(taskValidation.createTask), taskController.createTask)
  .get(auth('getHelpSupportHub'), validate(taskValidation.listTasks), taskController.listTasks);

router
  .route('/:taskId')
  .get(auth('getHelpSupportHub'), validate(taskValidation.taskIdParam), taskController.getTask)
  .patch(auth('getHelpSupportHub'), validate(taskValidation.updateTask), taskController.updateTask)
  .delete(auth('manageHelpSupportTasks'), validate(taskValidation.taskIdParam), taskController.deleteTask);

router.patch(
  '/:taskId/status',
  auth('getHelpSupportHub'),
  validate(taskValidation.updateStatus),
  taskController.updateStatus
);

router.patch(
  '/:taskId/assign',
  auth('manageHelpSupportTasks'),
  validate(taskValidation.assignTask),
  taskController.assignTask
);

router.post(
  '/:taskId/comments',
  auth('getHelpSupportHub'),
  validate(taskValidation.addComment),
  taskController.addComment
);

export default router;
