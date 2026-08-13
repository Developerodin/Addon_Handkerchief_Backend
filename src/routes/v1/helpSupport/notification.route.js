import express from 'express';
import auth from '../../../middlewares/auth.js';
import * as notificationController from '../../../controllers/helpSupport/taskNotification.controller.js';

const router = express.Router();

router.get('/', auth(), notificationController.listNotifications);
router.patch('/read', auth(), notificationController.markRead);

export default router;
