import httpStatus from 'http-status';
import pick from '../../utils/pick.js';
import catchAsync from '../../utils/catchAsync.js';
import * as taskService from '../../services/helpSupport/task.service.js';

const createTask = catchAsync(async (req, res) => {
  const task = await taskService.createTask(req.body, req.user);
  res.status(httpStatus.CREATED).send(task);
});

const listTasks = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['status', 'priority', 'search']);
  if (filter.search) {
    filter.$or = [
      { title: { $regex: filter.search, $options: 'i' } },
      { taskNumber: { $regex: filter.search, $options: 'i' } },
    ];
    delete filter.search;
  }
  if (req.query.assignedTo) filter.assignees = req.query.assignedTo;
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  const result = await taskService.queryTasks(filter, options, req.user);
  res.send(result);
});

const getTask = catchAsync(async (req, res) => {
  const task = await taskService.getTaskById(req.params.taskId, req.user);
  res.send(task);
});

const updateTask = catchAsync(async (req, res) => {
  const task = await taskService.updateTask(req.params.taskId, req.body, req.user);
  res.send(task);
});

const updateStatus = catchAsync(async (req, res) => {
  const task = await taskService.updateTaskStatus(req.params.taskId, req.body.status, req.user);
  res.send(task);
});

const assignTask = catchAsync(async (req, res) => {
  const task = await taskService.assignTask(req.params.taskId, req.body, req.user);
  res.send(task);
});

const addComment = catchAsync(async (req, res) => {
  const task = await taskService.addComment(
    req.params.taskId,
    req.body.body,
    req.user,
    req.body.attachments
  );
  res.send(task);
});

const deleteTask = catchAsync(async (req, res) => {
  await taskService.deleteTask(req.params.taskId, req.user);
  res.status(httpStatus.NO_CONTENT).send();
});

export { createTask, listTasks, getTask, updateTask, updateStatus, assignTask, addComment, deleteTask };
