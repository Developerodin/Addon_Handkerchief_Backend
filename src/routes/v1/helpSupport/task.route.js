import express from 'express';
import auth from '../../../middlewares/auth.js';
import validate from '../../../middlewares/validate.js';
import { requireCrud } from '../../../middlewares/requireCrud.js';
import * as taskValidation from '../../../validations/helpSupport/task.validation.js';
import * as taskController from '../../../controllers/helpSupport/task.controller.js';

import * as taskTeamController from '../../../controllers/helpSupport/taskTeam.controller.js';

const router = express.Router();
const HS_TASKS = 'Help & Support.Tasks';

router
  .route('/teams')
  .get(auth('getHelpSupportHub'), requireCrud(HS_TASKS, 'read'), taskTeamController.listTeams)
  .post(
    auth('manageHelpSupportTasks'),
    requireCrud(HS_TASKS, 'update'),
    validate(taskValidation.createTeam),
    taskTeamController.createTeam
  );

router.patch(
  '/teams/:teamId',
  auth('manageHelpSupportTasks'),
  requireCrud(HS_TASKS, 'update'),
  validate(taskValidation.updateTeam),
  taskTeamController.updateTeam
);

router
  .route('/')
  .post(
    auth('manageHelpSupportTasks'),
    requireCrud(HS_TASKS, 'create'),
    validate(taskValidation.createTask),
    taskController.createTask
  )
  .get(
    auth('getHelpSupportHub'),
    requireCrud(HS_TASKS, 'read'),
    validate(taskValidation.listTasks),
    taskController.listTasks
  );

router
  .route('/:taskId')
  .get(
    auth('getHelpSupportHub'),
    requireCrud(HS_TASKS, 'read'),
    validate(taskValidation.taskIdParam),
    taskController.getTask
  )
  .patch(
    auth('getHelpSupportHub'),
    requireCrud(HS_TASKS, 'update'),
    validate(taskValidation.updateTask),
    taskController.updateTask
  )
  .delete(
    auth('manageHelpSupportTasks'),
    requireCrud(HS_TASKS, 'delete'),
    validate(taskValidation.taskIdParam),
    taskController.deleteTask
  );

router.patch(
  '/:taskId/status',
  auth('getHelpSupportHub'),
  requireCrud(HS_TASKS, 'update'),
  validate(taskValidation.updateStatus),
  taskController.updateStatus
);

router.patch(
  '/:taskId/assign',
  auth('manageHelpSupportTasks'),
  requireCrud(HS_TASKS, 'update'),
  validate(taskValidation.assignTask),
  taskController.assignTask
);

router.post(
  '/:taskId/comments',
  auth('getHelpSupportHub'),
  requireCrud(HS_TASKS, 'update'),
  validate(taskValidation.addComment),
  taskController.addComment
);

export default router;
