import HelpSupportTaskNotification, {
  HelpSupportNotificationReadState,
} from '../../models/helpSupport/taskNotification.model.js';
import { hasHelpSupportTabAccess } from '../../utils/permissionTypes.js';

const NO_MATCH_FILTER = { _id: { $exists: false } };

/**
 * Build Mongo filter for notifications the user is allowed to see.
 * Task broadcasts require Tasks tab; ticket assignments require Tickets tab.
 * @param {{ _id?: import('mongoose').Types.ObjectId, id?: string, navigation?: object }} user
 */
const notificationFilterForUser = (user) => {
  const userId = user._id || user.id;
  const orClauses = [];

  if (hasHelpSupportTabAccess(user.navigation, 'tasks')) {
    orClauses.push({ type: 'task_created' });
  }
  if (hasHelpSupportTabAccess(user.navigation, 'tickets')) {
    orClauses.push({ type: 'ticket_assigned', recipientUser: userId });
  }

  if (!orClauses.length) {
    return NO_MATCH_FILTER;
  }
  return { $or: orClauses };
};

/**
 * Create a broadcast notification when a task is created.
 * @param {import('mongoose').Document} task
 * @param {{ _id: import('mongoose').Types.ObjectId }} user
 */
const createTaskCreatedNotification = async (task, user) => {
  return HelpSupportTaskNotification.create({
    type: 'task_created',
    taskId: task._id || task.id,
    taskNumber: task.taskNumber,
    title: task.title,
    priority: task.priority || 'medium',
    assignedTeams: task.assignedTeams || [],
    createdBy: user._id || user.id,
  });
};

/**
 * Notify assignee when a ticket is assigned to them.
 * @param {import('mongoose').Document} ticket
 * @param {import('mongoose').Types.ObjectId|string} assigneeId
 * @param {{ _id: import('mongoose').Types.ObjectId }} user
 */
const createTicketAssignedNotification = async (ticket, assigneeId, user) => {
  return HelpSupportTaskNotification.create({
    type: 'ticket_assigned',
    ticketId: ticket._id || ticket.id,
    ticketNumber: ticket.ticketNumber,
    title: ticket.title,
    priority: ticket.priority || 'medium',
    recipientUser: assigneeId,
    createdBy: user._id || user.id,
  });
};

/**
 * List recent hub notifications for the current user.
 * @param {{ _id: import('mongoose').Types.ObjectId }} user
 * @param {{ limit?: number }} [options]
 */
const listNotifications = async (user, options = {}) => {
  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 20;
  const userId = user._id || user.id;
  const filter = notificationFilterForUser(user);

  const readState = await HelpSupportNotificationReadState.findOne({ user: userId });
  const lastSeenAt = readState?.lastSeenAt || null;

  const notifications = await HelpSupportTaskNotification.find(filter)
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate('createdBy', 'name email');

  const unreadCount = lastSeenAt
    ? await HelpSupportTaskNotification.countDocuments({
        ...filter,
        createdAt: { $gt: lastSeenAt },
      })
    : await HelpSupportTaskNotification.countDocuments(filter);

  return {
    results: notifications.map((doc) => doc.toJSON()),
    unreadCount,
    lastSeenAt,
  };
};

/**
 * Mark all hub notifications as read for the current user.
 * @param {{ _id: import('mongoose').Types.ObjectId }} user
 */
const markNotificationsRead = async (user) => {
  const now = new Date();
  await HelpSupportNotificationReadState.findOneAndUpdate(
    { user: user._id || user.id },
    { lastSeenAt: now },
    { upsert: true, new: true }
  );
  return { lastSeenAt: now };
};

export {
  createTaskCreatedNotification,
  createTicketAssignedNotification,
  listNotifications,
  markNotificationsRead,
};
