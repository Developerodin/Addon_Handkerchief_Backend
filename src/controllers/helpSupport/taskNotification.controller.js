import catchAsync from '../../utils/catchAsync.js';
import * as notificationService from '../../services/helpSupport/taskNotification.service.js';

const listNotifications = catchAsync(async (req, res) => {
  const limit = req.query.limit ? parseInt(req.query.limit, 10) : 20;
  const result = await notificationService.listNotifications(req.user, { limit });
  res.send(result);
});

const markRead = catchAsync(async (req, res) => {
  const result = await notificationService.markNotificationsRead(req.user);
  res.send(result);
});

export { listNotifications, markRead };
