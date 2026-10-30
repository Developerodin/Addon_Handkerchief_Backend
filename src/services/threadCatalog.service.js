import httpStatus from 'http-status';
import ThreadCatalog from '../models/threadCatalog.model.js';
import ApiError from '../utils/ApiError.js';
import { escapeRegex } from '../utils/fabricLookupCrud.js';

/**
 * Trims thread code and type when those keys are present.
 * @param {object} body
 * @returns {object}
 */
const normalizeBody = (body) => {
  if (!body) return body;
  const next = { ...body };
  if (next.threadCode != null) next.threadCode = String(next.threadCode).trim();
  if (next.threadType != null) next.threadType = String(next.threadType).trim();
  return next;
};

/**
 * Rejects a thread code that another catalog row already uses.
 * @param {string} threadCode
 * @param {string} [excludeId]
 * @returns {Promise<void>}
 */
const assertUniqueThreadCode = async (threadCode, excludeId) => {
  if (!threadCode) return;
  const existing = await ThreadCatalog.findOne({
    threadCode,
    ...(excludeId ? { _id: { $ne: excludeId } } : {}),
  });
  if (existing) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Thread code already exists');
  }
};

/**
 * Turns a unique-index collision into a validation error.
 * @param {unknown} error
 * @returns {never}
 */
const rethrowDuplicate = (error) => {
  if (error && typeof error === 'object' && error.code === 11000) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Thread code already exists');
  }
  throw error;
};

/**
 * Creates a thread catalog row.
 * @param {object} body
 * @returns {Promise<import('mongoose').Document>}
 */
export const createThreadCatalog = async (body) => {
  const payload = normalizeBody(body);
  await assertUniqueThreadCode(payload.threadCode);
  try {
    return await ThreadCatalog.create(payload);
  } catch (error) {
    rethrowDuplicate(error);
  }
};

/**
 * Lists thread catalog rows, optionally filtered by a search string.
 * @param {object} filter
 * @param {object} options
 * @param {string} [search]
 * @returns {Promise<object>}
 */
export const queryThreadCatalogs = async (filter, options, search) => {
  let queryFilter = { ...filter };
  if (search && typeof search === 'string' && search.trim()) {
    const searchRegex = new RegExp(escapeRegex(search.trim()), 'i');
    const searchFilter = {
      $or: [{ threadCode: searchRegex }, { threadType: searchRegex }],
    };
    queryFilter = Object.keys(queryFilter).length ? { $and: [queryFilter, searchFilter] } : searchFilter;
  }
  return ThreadCatalog.paginate(queryFilter, options);
};

/**
 * Loads one thread catalog row by id.
 * @param {string} id
 * @returns {Promise<import('mongoose').Document | null>}
 */
export const getThreadCatalogById = async (id) => ThreadCatalog.findById(id);

/**
 * Updates a thread catalog row.
 * @param {string} threadId
 * @param {object} updateBody
 * @returns {Promise<import('mongoose').Document>}
 */
export const updateThreadCatalogById = async (threadId, updateBody) => {
  const thread = await ThreadCatalog.findById(threadId);
  if (!thread) throw new ApiError(httpStatus.NOT_FOUND, 'Thread not found');
  const payload = normalizeBody(updateBody);
  if (payload.threadCode) {
    await assertUniqueThreadCode(payload.threadCode, threadId);
  }
  Object.assign(thread, payload);
  try {
    await thread.save();
  } catch (error) {
    rethrowDuplicate(error);
  }
  return thread;
};

/**
 * Deletes a thread catalog row.
 * @param {string} threadId
 * @returns {Promise<import('mongoose').Document>}
 */
export const deleteThreadCatalogById = async (threadId) => {
  const thread = await ThreadCatalog.findById(threadId);
  if (!thread) throw new ApiError(httpStatus.NOT_FOUND, 'Thread not found');
  await thread.deleteOne();
  return thread;
};
