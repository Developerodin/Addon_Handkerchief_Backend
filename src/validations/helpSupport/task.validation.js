import Joi from 'joi';
import { objectId } from '../custom.validation.js';

const attachment = Joi.object().keys({
  fileName: Joi.string().trim(),
  url: Joi.string().uri().trim(),
  key: Joi.string().trim(),
  size: Joi.number().integer().min(0),
  mimeType: Joi.string().trim(),
});

const createTask = {
  body: Joi.object().keys({
    title: Joi.string().required().trim().max(200),
    description: Joi.string().trim().allow(''),
    priority: Joi.string().valid('low', 'medium', 'high', 'urgent'),
    dueDate: Joi.date().iso().allow(null),
    assignedTeams: Joi.array().items(Joi.string().trim().lowercase()).min(1),
    assignees: Joi.array().items(Joi.string().custom(objectId)),
    attachments: Joi.array().items(attachment),
  }).or('assignedTeams', 'assignees'),
};

const createTeam = {
  body: Joi.object().keys({
    slug: Joi.string().trim().lowercase().max(60),
    name: Joi.string().required().trim().max(80),
    description: Joi.string().trim().max(500).allow(''),
    roles: Joi.array().items(Joi.string().trim().lowercase()),
    sortOrder: Joi.number().integer().min(0),
    isActive: Joi.boolean(),
  }),
};

const updateTeam = {
  params: Joi.object().keys({ teamId: Joi.string().custom(objectId).required() }),
  body: Joi.object()
    .keys({
      name: Joi.string().trim().max(80),
      description: Joi.string().trim().max(500).allow(''),
      roles: Joi.array().items(Joi.string().trim().lowercase()),
      sortOrder: Joi.number().integer().min(0),
      isActive: Joi.boolean(),
    })
    .min(1),
};

const updateTask = {
  params: Joi.object().keys({ taskId: Joi.string().custom(objectId).required() }),
  body: Joi.object()
    .keys({
      title: Joi.string().trim().max(200),
      description: Joi.string().trim().allow(''),
      priority: Joi.string().valid('low', 'medium', 'high', 'urgent'),
      dueDate: Joi.date().iso().allow(null),
      assignees: Joi.array().items(Joi.string().custom(objectId)),
      assignedTeams: Joi.array().items(Joi.string().trim().lowercase()),
      attachments: Joi.array().items(attachment),
    })
    .min(1),
};

const taskIdParam = {
  params: Joi.object().keys({ taskId: Joi.string().custom(objectId).required() }),
};

const listTasks = {
  query: Joi.object().keys({
    status: Joi.string().valid('todo', 'in_progress', 'blocked', 'done', 'cancelled'),
    priority: Joi.string().valid('low', 'medium', 'high', 'urgent'),
    assignedTo: Joi.string().custom(objectId),
    search: Joi.string().trim(),
    sortBy: Joi.string(),
    limit: Joi.number().integer(),
    page: Joi.number().integer(),
    dateFrom: Joi.date().iso(),
    dateTo: Joi.date().iso(),
  }),
};

const updateStatus = {
  ...taskIdParam,
  body: Joi.object().keys({
    status: Joi.string().valid('todo', 'in_progress', 'blocked', 'done', 'cancelled').required(),
  }),
};

const assignTask = {
  ...taskIdParam,
  body: Joi.object().keys({
    assignees: Joi.array().items(Joi.string().custom(objectId)),
    assignedTeams: Joi.array().items(Joi.string().trim().lowercase()),
  }).or('assignees', 'assignedTeams'),
};

const addComment = {
  ...taskIdParam,
  body: Joi.object().keys({
    body: Joi.string().required().trim(),
    attachments: Joi.array().items(attachment),
  }),
};

export { createTask, updateTask, taskIdParam, listTasks, updateStatus, assignTask, addComment, createTeam, updateTeam };
