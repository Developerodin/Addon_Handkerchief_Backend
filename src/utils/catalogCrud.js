import httpStatus from 'http-status';
import ApiError from '../utils/ApiError.js';

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const createCatalogCrud = (Model, { resourceName, searchFields = [], populate = null, uniqueField = null }) => {
  const applySearch = (filter, search) => {
    let queryFilter = { ...filter };
    if (search && typeof search === 'string' && search.trim()) {
      const searchRegex = new RegExp(escapeRegex(search.trim()), 'i');
      const searchFilter = {
        $or: searchFields.map((field) => ({ [field]: searchRegex })),
      };
      queryFilter = Object.keys(queryFilter).length ? { $and: [queryFilter, searchFilter] } : searchFilter;
    }
    return queryFilter;
  };

  const create = async (body) => {
    if (uniqueField && body[uniqueField]) {
      const existing = await Model.findOne({ [uniqueField]: body[uniqueField] });
      if (existing) throw new ApiError(httpStatus.BAD_REQUEST, `${resourceName} already exists`);
    }
    return Model.create(body);
  };

  const query = async (filter, options, search) => {
    const queryOptions = { ...options };
    if (populate && !queryOptions.populate) queryOptions.populate = populate;
    return Model.paginate(applySearch(filter, search), queryOptions);
  };

  const getById = async (id) => {
    const q = Model.findById(id);
    if (populate) q.populate(populate);
    return q;
  };

  const updateById = async (id, updateBody) => {
    const doc = await getById(id);
    if (!doc) throw new ApiError(httpStatus.NOT_FOUND, `${resourceName} not found`);
    if (uniqueField && updateBody[uniqueField]) {
      const existing = await Model.findOne({ [uniqueField]: updateBody[uniqueField], _id: { $ne: id } });
      if (existing) throw new ApiError(httpStatus.BAD_REQUEST, `${resourceName} already exists`);
    }
    Object.assign(doc, updateBody);
    await doc.save();
    return populate ? doc.populate(populate) : doc;
  };

  const deleteById = async (id) => {
    const doc = await Model.findById(id);
    if (!doc) throw new ApiError(httpStatus.NOT_FOUND, `${resourceName} not found`);
    await doc.deleteOne();
    return doc;
  };

  return { create, query, getById, updateById, deleteById };
};
