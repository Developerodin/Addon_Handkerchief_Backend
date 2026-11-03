import Joi from 'joi';

const sortBy = Joi.string().valid(
  'fabricName',
  'onRackMeters',
  'qcPassedMeters',
  'unallocatedMeters',
  'rollCount',
  'issuedMeters',
  'availableMeters',
  'status'
);

export const getLiveInventory = {
  query: Joi.object().keys({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
    search: Joi.string().trim().allow('').max(120),
    status: Joi.string().valid('all', 'In Stock', 'Low Stock', 'Out of Stock').default('all'),
    sortBy: sortBy.default('fabricName'),
    sortOrder: Joi.string().valid('asc', 'desc').default('asc'),
    format: Joi.string().valid('csv'),
  }),
};

export const getUnallocatedRolls = {
  query: Joi.object().keys({
    fabricId: Joi.string().trim().max(64).allow('').required(),
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(50).default(50),
  }),
};
