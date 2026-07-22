import httpStatus from 'http-status';
import { Category } from '../models/index.js';
import ApiError from '../utils/ApiError.js';

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const assertUniqueCategoryName = async (name, parent, excludeId = null) => {
  const filter = {
    name: { $regex: new RegExp(`^${escapeRegex(name.trim())}$`, 'i') },
    parent: parent || null,
  };
  if (excludeId) {
    filter._id = { $ne: excludeId };
  }
  const existing = await Category.findOne(filter);
  if (existing) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Category already exists under this parent');
  }
};

/**
 * Create a category
 * @param {Object} categoryBody
 * @returns {Promise<Category>}
 */
export const createCategory = async (categoryBody) => {
  await assertUniqueCategoryName(categoryBody.name, categoryBody.parent);
  return Category.create(categoryBody);
};

/**
 * Query for categories
 * @param {Object} filter - Mongo filter
 * @param {Object} options - Query options
 * @param {string} [options.sortBy] - Sort option in the format: sortField:(desc|asc)
 * @param {number} [options.limit] - Maximum number of results per page (default = 10)
 * @param {number} [options.page] - Current page (default = 1)
 * @param {string} [search] - Search term to filter across multiple fields
 * @returns {Promise<QueryResult>}
 */
export const queryCategories = async (filter, options, search) => {
  // Handle search parameter - search across multiple fields
  if (search && typeof search === 'string' && search.trim()) {
    const searchTerm = search.trim();
    // Escape special regex characters
    const escapedSearch = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const searchRegex = new RegExp(escapedSearch, 'i');
    
    // Build $or query to search across multiple fields
    const searchFilter = {
      $or: [
        { name: searchRegex },
        { description: searchRegex },
      ],
    };
    
    // Combine search filter with existing filter using $and
    if (Object.keys(filter).length > 0) {
      filter = {
        $and: [filter, searchFilter],
      };
    } else {
      filter = searchFilter;
    }
  }
  
  const queryOptions = { ...options };
  if (!queryOptions.populate) {
    queryOptions.populate = 'parent';
  }

  const categories = await Category.paginate(filter, queryOptions);
  return categories;
};

/**
 * Get category by id
 * @param {ObjectId} id
 * @returns {Promise<Category>}
 */
export const getCategoryById = async (id) => {
  return Category.findById(id);
};

/**
 * Update category by id
 * @param {ObjectId} categoryId
 * @param {Object} updateBody
 * @returns {Promise<Category>}
 */
export const updateCategoryById = async (categoryId, updateBody) => {
  const category = await getCategoryById(categoryId);
  if (!category) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Category not found');
  }
  const name = updateBody.name ?? category.name;
  const parent = updateBody.parent !== undefined ? updateBody.parent : category.parent;
  await assertUniqueCategoryName(name, parent, categoryId);
  Object.assign(category, updateBody);
  await category.save();
  return category;
};

/**
 * Delete category by id
 * @param {ObjectId} categoryId
 * @returns {Promise<Category>}
 */
export const deleteCategoryById = async (categoryId) => {
  const category = await getCategoryById(categoryId);
  if (!category) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Category not found');
  }
  await category.deleteOne();
  return category;
}; 