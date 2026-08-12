import httpStatus from 'http-status';
import ApiError from '../../utils/ApiError.js';
import {
  canManageTasks,
  canViewTask,
  isManagement,
  normalizeRole,
} from '../../utils/collaborationRole.util.js';
import HelpSupportTask, { HelpSupportTaskCounter, TASK_STATUS, TASK_PRIORITY } from '../../models/helpSupport/task.model.js';
import User from '../../models/user.model.js';
import { getTeamsForRole } from './taskTeam.service.js';

const generateTaskNumber = async () => {
  const year = new Date().getFullYear();
  const key = `HT-${year}`;
  const counter = await HelpSupportTaskCounter.findOneAndUpdate(
    { key },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return `${key}-${String(counter.seq).padStart(5, '0')}`;
};

const POPULATE_PATHS = [
  { path: 'createdBy', select: 'name email role' },
  { path: 'assignees', select: 'name email role' },
  { path: 'comments.author', select: 'name email role' },
  { path: 'activityLog.actor', select: 'name email role' },
];

const populateTask = (query) => query.populate(POPULATE_PATHS);

const actorIdFromRef = (ref) => {
  if (!ref) return null;
  if (typeof ref === 'string') return ref;
  if (ref._id) return ref._id.toString();
  if (ref.id) return String(ref.id);
  return null;
};

const formatUserRef = (ref) => {
  if (!ref) return ref;
  if (typeof ref === 'object' && (ref.name || ref.email)) {
    const json = ref.toJSON ? ref.toJSON() : ref;
    return {
      id: json.id || json._id?.toString(),
      name: json.name,
      email: json.email,
      role: json.role,
    };
  }
  return actorIdFromRef(ref);
};

const hydrateUserRefs = async (task) => {
  const plain = task.toJSON ? task.toJSON() : { ...task };
  const ids = new Set();

  const collectId = (ref) => {
    const id = actorIdFromRef(ref);
    if (!id) return;
    if (typeof ref === 'string' || (typeof ref === 'object' && !ref.name && !ref.email)) {
      ids.add(String(id));
    }
  };

  collectId(plain.createdBy);
  (plain.assignees || []).forEach(collectId);
  (plain.comments || []).forEach((comment) => collectId(comment.author));
  (plain.activityLog || []).forEach((entry) => collectId(entry.actor));

  if (!ids.size) return plain;

  const users = await User.find({ _id: { $in: [...ids] } }).select('name email role').lean();
  const byId = new Map(
    users.map((user) => [
      String(user._id),
      {
        id: String(user._id),
        name: user.name,
        email: user.email,
        role: user.role,
      },
    ])
  );

  const resolveRef = (ref) => {
    const id = actorIdFromRef(ref);
    if (id && byId.has(String(id))) return byId.get(String(id));
    return formatUserRef(ref);
  };

  const resolveActivityEntry = (entry) => {
    const actor = resolveRef(entry.actor);
    const actorName = entry.actorName?.trim();
    if (actorName) {
      if (typeof actor === 'object' && actor !== null) {
        return { ...entry, actor: { ...actor, name: actor.name || actorName, email: actor.email } };
      }
      if (typeof actor === 'string') {
        return { ...entry, actor: { id: actor, name: actorName } };
      }
    }
    return { ...entry, actor };
  };

  plain.createdBy = resolveRef(plain.createdBy);
  plain.assignees = (plain.assignees || []).map(resolveRef);
  plain.comments = (plain.comments || []).map((comment) => ({
    ...comment,
    author: resolveRef(comment.author),
  }));
  plain.activityLog = (plain.activityLog || []).map((entry) => resolveActivityEntry(entry));

  return plain;
};

const loadTaskById = async (taskId) => {
  const task = await populateTask(HelpSupportTask.findOne({ _id: taskId, isDeleted: false }));
  if (!task) return null;
  return hydrateUserRefs(task);
};

const findTaskDocument = async (taskId, user) => {
  const taskDoc = await HelpSupportTask.findOne({ _id: taskId, isDeleted: false });
  if (!taskDoc) throw new ApiError(httpStatus.NOT_FOUND, 'Task not found');
  if (!canViewTask(user, taskDoc)) throw new ApiError(httpStatus.FORBIDDEN, 'Forbidden');
  return taskDoc;
};

const pushActivity = (task, entry) => {
  task.activityLog.push(entry);
};

const actorLabel = (user) => user?.name?.trim() || user?.email?.trim() || 'Unknown user';

const activityEntry = (user, entry) => ({
  ...entry,
  actor: user._id || user.id,
  actorName: actorLabel(user),
});

const formatStatus = (status) => String(status || '').replace(/_/g, ' ');

const createTask = async (body, user) => {
  if (!canManageTasks(user)) {
    throw new ApiError(httpStatus.FORBIDDEN, 'Only Management can create tasks');
  }
  const taskNumber = await generateTaskNumber();
  const teams = body.assignedTeams || [];
  const task = await HelpSupportTask.create({
    ...body,
    taskNumber,
    createdBy: user._id || user.id,
    activityLog: [
      activityEntry(user, {
        type: 'created',
        teams,
        message: teams.length
          ? `Task created and assigned to ${teams.join(', ').replace(/_/g, ' ')}`
          : 'Task created',
      }),
    ],
  });
  return loadTaskById(task.id);
};

const queryTasks = async (filter, options, user) => {
  const baseFilter = { isDeleted: false, ...filter };
  if (!isManagement(user)) {
    const role = normalizeRole(user?.role);
    const teamSlugs = await getTeamsForRole(role);
    if (teamSlugs.length) {
      baseFilter.assignedTeams = { $in: teamSlugs };
    } else {
      baseFilter.assignees = user._id || user.id;
    }
  }
  const result = await HelpSupportTask.paginate(baseFilter, {
    ...options,
    populate: 'createdBy,assignees',
    sortBy: options.sortBy || 'createdAt:desc',
  });
  return result;
};

const getTaskById = async (taskId, user) => {
  const taskDoc = await findTaskDocument(taskId, user);
  await taskDoc.populate(POPULATE_PATHS).execPopulate();
  return hydrateUserRefs(taskDoc);
};

const updateTask = async (taskId, updateBody, user) => {
  const task = await findTaskDocument(taskId, user);
  if (!canManageTasks(user)) {
    throw new ApiError(httpStatus.FORBIDDEN, 'Only Management can update task details');
  }
  Object.assign(task, updateBody);
  await task.save();
  return loadTaskById(task.id);
};

const updateTaskStatus = async (taskId, status, user) => {
  if (!TASK_STATUS.includes(status)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid status');
  }
  const task = await findTaskDocument(taskId, user);
  const previous = task.status;
  if (previous !== status) {
    pushActivity(task, activityEntry(user, {
      type: 'status_changed',
      fromStatus: previous,
      toStatus: status,
      message: `Status updated from ${formatStatus(previous)} to ${formatStatus(status)}`,
    }));
    task.status = status;
    await task.save();
  }
  return loadTaskById(task.id);
};

const assignTask = async (taskId, body, user) => {
  if (!canManageTasks(user)) {
    throw new ApiError(httpStatus.FORBIDDEN, 'Only Management can assign tasks');
  }
  const task = await findTaskDocument(taskId, user);
  if (body.assignees !== undefined) task.assignees = body.assignees;
  if (body.assignedTeams !== undefined) {
    task.assignedTeams = body.assignedTeams;
    pushActivity(task, activityEntry(user, {
      type: 'teams_assigned',
      teams: body.assignedTeams,
      message: `Assigned to ${body.assignedTeams.join(', ').replace(/_/g, ' ')}`,
    }));
  }
  await task.save();
  return loadTaskById(task.id);
};

const addComment = async (taskId, body, user, attachments = []) => {
  const task = await findTaskDocument(taskId, user);
  const actorId = user._id || user.id;
  task.comments.push({
    author: actorId,
    body,
    attachments,
  });
  pushActivity(task, activityEntry(user, {
    type: 'comment',
    message: body,
  }));
  await task.save();
  return loadTaskById(task.id);
};

const deleteTask = async (taskId, user) => {
  if (!canManageTasks(user)) {
    throw new ApiError(httpStatus.FORBIDDEN, 'Only Management can delete tasks');
  }
  const task = await findTaskDocument(taskId, user);
  task.isDeleted = true;
  await task.save();
};

export {
  createTask,
  queryTasks,
  getTaskById,
  updateTask,
  updateTaskStatus,
  assignTask,
  addComment,
  deleteTask,
  TASK_STATUS,
  TASK_PRIORITY,
};
