import httpStatus from 'http-status';
import ApiError from './ApiError.js';

export const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const createLookupEntity = async (Model, body, { uniqueField = 'name', entityLabel = 'Record' } = {}) => {
  const payload = { ...body };
  if (payload[uniqueField]) {
    const existing = await Model.findOne({
      [uniqueField]: new RegExp(`^${escapeRegex(String(payload[uniqueField]).trim())}$`, 'i'),
    });
    if (existing) {
      throw new ApiError(httpStatus.BAD_REQUEST, `${entityLabel} already exists`);
    }
  }
  return Model.create(payload);
};

export const queryLookupEntities = async (Model, filter, options, search, searchFields = ['name']) => {
  let queryFilter = { ...filter };
  if (search && typeof search === 'string' && search.trim()) {
    const searchRegex = new RegExp(escapeRegex(search.trim()), 'i');
    const searchFilter = {
      $or: searchFields.map((field) => ({ [field]: searchRegex })),
    };
    queryFilter = Object.keys(queryFilter).length ? { $and: [queryFilter, searchFilter] } : searchFilter;
  }
  return Model.paginate(queryFilter, options);
};

export const getLookupEntityById = async (Model, id) => Model.findById(id);

export const updateLookupEntityById = async (
  Model,
  entityId,
  updateBody,
  { uniqueField = 'name', entityLabel = 'Record' } = {}
) => {
  const entity = await Model.findById(entityId);
  if (!entity) {
    throw new ApiError(httpStatus.NOT_FOUND, `${entityLabel} not found`);
  }
  const payload = { ...updateBody };
  if (payload[uniqueField]) {
    const existing = await Model.findOne({
      [uniqueField]: new RegExp(`^${escapeRegex(String(payload[uniqueField]).trim())}$`, 'i'),
      _id: { $ne: entityId },
    });
    if (existing) {
      throw new ApiError(httpStatus.BAD_REQUEST, `${entityLabel} already exists`);
    }
  }
  Object.assign(entity, payload);
  await entity.save();
  return entity;
};

export const deleteLookupEntityById = async (Model, entityId, entityLabel = 'Record') => {
  const entity = await Model.findById(entityId);
  if (!entity) {
    throw new ApiError(httpStatus.NOT_FOUND, `${entityLabel} not found`);
  }
  await entity.deleteOne();
  return entity;
};
