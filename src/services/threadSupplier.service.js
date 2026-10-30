import httpStatus from 'http-status';
import ThreadSupplier from '../models/threadSupplier.model.js';
import ThreadCatalog from '../models/threadCatalog.model.js';
import ApiError from '../utils/ApiError.js';
import { escapeRegex } from '../utils/fabricLookupCrud.js';

const SUPPLIER_POPULATE = {
  path: 'threadDetails.threadCatalogId',
  select: 'threadCode threadType status',
};

/**
 * Copies thread code and type from the catalog onto each supplier line.
 * Rejects a missing catalog id, a duplicate line, or an unknown catalog row.
 * @param {Array<{ threadCatalogId?: string }>} threadDetails
 * @returns {Promise<Array<{ threadCatalogId: string, threadCode: string, threadType: string }>>}
 */
const resolveThreadDetails = async (threadDetails) => {
  if (!Array.isArray(threadDetails)) {
    return [];
  }

  const seen = new Set();
  const resolved = [];

  for (const detail of threadDetails) {
    const threadCatalogId = String(detail?.threadCatalogId || '').trim();
    if (!threadCatalogId) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Thread catalog id is required for each thread detail');
    }
    if (seen.has(threadCatalogId)) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Duplicate thread selected in thread details');
    }
    seen.add(threadCatalogId);

    const thread = await ThreadCatalog.findById(threadCatalogId);
    if (!thread) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Thread catalog entry not found');
    }

    resolved.push({
      threadCatalogId,
      threadCode: thread.threadCode || '',
      threadType: thread.threadType || '',
    });
  }

  return resolved;
};

/**
 * Resolves thread detail lines when the payload includes them.
 * @param {object} body
 * @returns {Promise<object>}
 */
const normalizeBody = async (body) => {
  if (!body) return body;
  const next = { ...body };
  if (Object.prototype.hasOwnProperty.call(next, 'threadDetails')) {
    next.threadDetails = await resolveThreadDetails(next.threadDetails);
  }
  return next;
};

/**
 * Creates a thread supplier.
 * @param {object} body
 * @returns {Promise<import('mongoose').Document>}
 */
export const createThreadSupplier = async (body) => {
  const payload = await normalizeBody(body);
  const supplier = await ThreadSupplier.create(payload);
  return supplier.populate(SUPPLIER_POPULATE);
};

/**
 * Lists thread suppliers, optionally filtered by a search string.
 * @param {object} filter
 * @param {object} options
 * @param {string} [search]
 * @returns {Promise<object>}
 */
export const queryThreadSuppliers = async (filter, options, search) => {
  let queryFilter = { ...filter };
  if (search && typeof search === 'string' && search.trim()) {
    const searchRegex = new RegExp(escapeRegex(search.trim()), 'i');
    const searchFilter = {
      $or: [
        { name: searchRegex },
        { contactPerson: searchRegex },
        { contactNumber: searchRegex },
        { email: searchRegex },
        { address: searchRegex },
        { city: searchRegex },
        { gstin: searchRegex },
        { paymentTerms: searchRegex },
        { 'threadDetails.threadCode': searchRegex },
        { 'threadDetails.threadType': searchRegex },
      ],
    };
    queryFilter = Object.keys(queryFilter).length ? { $and: [queryFilter, searchFilter] } : searchFilter;
  }
  const queryOptions = { ...options };
  if (!queryOptions.populate) {
    queryOptions.populate = [SUPPLIER_POPULATE];
  }
  return ThreadSupplier.paginate(queryFilter, queryOptions);
};

/**
 * Loads one thread supplier by id.
 * @param {string} id
 * @returns {Promise<import('mongoose').Document | null>}
 */
export const getThreadSupplierById = async (id) => ThreadSupplier.findById(id).populate(SUPPLIER_POPULATE);

/**
 * Updates a thread supplier.
 * @param {string} supplierId
 * @param {object} updateBody
 * @returns {Promise<import('mongoose').Document>}
 */
export const updateThreadSupplierById = async (supplierId, updateBody) => {
  const supplier = await ThreadSupplier.findById(supplierId);
  if (!supplier) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Thread supplier not found');
  }
  const payload = await normalizeBody(updateBody);
  Object.assign(supplier, payload);
  await supplier.save();
  return supplier.populate(SUPPLIER_POPULATE);
};

/**
 * Deletes a thread supplier.
 * @param {string} supplierId
 * @returns {Promise<import('mongoose').Document>}
 */
export const deleteThreadSupplierById = async (supplierId) => {
  const supplier = await getThreadSupplierById(supplierId);
  if (!supplier) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Thread supplier not found');
  }
  await supplier.deleteOne();
  return supplier;
};
