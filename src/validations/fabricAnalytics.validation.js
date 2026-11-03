import Joi from 'joi';

const sortBy = Joi.string().valid(
  'fabricName',
  'inventoryMeters',
  'inOrderMeters',
  'draftMeters',
  'draftPoCount',
  'unallocatedMeters',
  'onRackMeters'
);

const getFabricAnalytics = {
  query: Joi.object().keys({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
    search: Joi.string().trim().allow('').max(120),
    sortBy: sortBy.default('fabricName'),
    sortOrder: Joi.string().valid('asc', 'desc').default('asc'),
  }),
};

export default getFabricAnalytics;
