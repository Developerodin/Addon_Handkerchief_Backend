import httpStatus from 'http-status';
import { Category, Product } from '../models/index.js';
import ApiError from '../utils/ApiError.js';

export const MAX_CATEGORY_DEPTH = 3;

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const getParentId = (category) => {
  if (!category?.parent) return null;
  if (typeof category.parent === 'object') {
    return String(category.parent._id || category.parent.id || '');
  }
  return String(category.parent);
};

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
 * Walk up the parent chain and return depth (1 = root).
 */
export const getCategoryDepth = async (categoryId) => {
  let depth = 1;
  let currentId = categoryId ? String(categoryId) : null;
  const visited = new Set();

  while (currentId) {
    if (visited.has(currentId)) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Circular category hierarchy detected');
    }
    visited.add(currentId);

    const cat = await Category.findById(currentId).select('parent');
    if (!cat) break;

    const parentId = getParentId(cat);
    if (!parentId) return depth;

    depth += 1;
    currentId = parentId;
  }

  return depth;
};

/**
 * All descendant ids (children, grandchildren, etc.) for a category.
 */
export const getDescendantIds = async (categoryId) => {
  const all = await Category.find({}, '_id parent').lean();
  const childrenByParent = new Map();

  for (const cat of all) {
    const parentId = getParentId(cat);
    if (!parentId) continue;
    const list = childrenByParent.get(parentId) || [];
    list.push(String(cat._id));
    childrenByParent.set(parentId, list);
  }

  const descendants = [];
  const stack = [...(childrenByParent.get(String(categoryId)) || [])];

  while (stack.length) {
    const id = stack.pop();
    descendants.push(id);
    stack.push(...(childrenByParent.get(id) || []));
  }

  return descendants;
};

/**
 * Max depth of subtree relative to the category itself (1 = no children).
 */
export const getMaxSubtreeRelativeDepth = async (categoryId) => {
  const all = await Category.find({}, '_id parent').lean();
  const childrenByParent = new Map();

  for (const cat of all) {
    const parentId = getParentId(cat);
    if (!parentId) continue;
    const list = childrenByParent.get(parentId) || [];
    list.push(String(cat._id));
    childrenByParent.set(parentId, list);
  }

  const walk = (id) => {
    const children = childrenByParent.get(String(id)) || [];
    if (!children.length) return 1;
    return 1 + Math.max(...children.map((childId) => walk(childId)));
  };

  return walk(String(categoryId));
};

const assertValidParentAssignment = async (categoryId, parentId) => {
  if (!parentId) return;

  if (categoryId && String(parentId) === String(categoryId)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Category cannot be its own parent');
  }

  const parent = await Category.findById(parentId);
  if (!parent) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Parent category not found');
  }

  const parentDepth = await getCategoryDepth(parentId);
  const newDepth = parentDepth + 1;
  if (newDepth > MAX_CATEGORY_DEPTH) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Maximum category depth is ${MAX_CATEGORY_DEPTH} (Category → Child → Grandchild)`
    );
  }

  if (categoryId) {
    const descendants = await getDescendantIds(categoryId);
    if (descendants.includes(String(parentId))) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Parent cannot be a descendant of this category');
    }

    const subtreeRelativeDepth = await getMaxSubtreeRelativeDepth(categoryId);
    if (newDepth + subtreeRelativeDepth - 1 > MAX_CATEGORY_DEPTH) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        'Moving this category would exceed the maximum depth for its child categories'
      );
    }
  }
};

/**
 * Create a category
 * @param {Object} categoryBody
 * @returns {Promise<Category>}
 */
export const createCategory = async (categoryBody) => {
  await assertUniqueCategoryName(categoryBody.name, categoryBody.parent);
  await assertValidParentAssignment(null, categoryBody.parent);
  return Category.create(categoryBody);
};

/**
 * Query for categories
 * @param {Object} filter - Mongo filter
 * @param {Object} options - Query options
 * @param {string} [search] - Search term to filter across multiple fields
 * @returns {Promise<QueryResult>}
 */
export const queryCategories = async (filter, options, search) => {
  if (search && typeof search === 'string' && search.trim()) {
    const searchTerm = search.trim();
    const escapedSearch = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const searchRegex = new RegExp(escapedSearch, 'i');

    const searchFilter = {
      $or: [{ name: searchRegex }, { description: searchRegex }],
    };

    if (Object.keys(filter).length > 0) {
      filter = { $and: [filter, searchFilter] };
    } else {
      filter = searchFilter;
    }
  }

  const queryOptions = { ...options };
  if (!queryOptions.populate) {
    queryOptions.populate = 'parent';
  }

  return Category.paginate(filter, queryOptions);
};

/**
 * Get category by id
 * @param {ObjectId} id
 * @returns {Promise<Category>}
 */
export const getCategoryById = async (id) => {
  return Category.findById(id).populate('parent');
};

/**
 * Update category by id
 * @param {ObjectId} categoryId
 * @param {Object} updateBody
 * @returns {Promise<Category>}
 */
export const updateCategoryById = async (categoryId, updateBody) => {
  const category = await Category.findById(categoryId);
  if (!category) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Category not found');
  }

  const name = updateBody.name ?? category.name;
  const parent =
    updateBody.parent !== undefined
      ? updateBody.parent || null
      : getParentId(category) || null;

  await assertUniqueCategoryName(name, parent, categoryId);

  if (updateBody.parent !== undefined) {
    await assertValidParentAssignment(categoryId, parent);
  }

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
  const category = await Category.findById(categoryId);
  if (!category) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Category not found');
  }

  const childCount = await Category.countDocuments({ parent: categoryId });
  if (childCount > 0) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Cannot delete category with child categories. Delete or reassign children first.'
    );
  }

  const productCount = await Product.countDocuments({ category: categoryId });
  if (productCount > 0) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      'Cannot delete category linked to products. Reassign products first.'
    );
  }

  await category.deleteOne();
  return category;
};

/**
 * Build nested category tree up to maxDepth levels.
 */
export const getCategoryTree = async (maxDepth = MAX_CATEGORY_DEPTH) => {
  const categories = await Category.find({ status: { $ne: 'inactive' } })
    .sort({ sortOrder: 1, name: 1 })
    .lean();

  const byId = new Map(categories.map((cat) => [String(cat._id), { ...cat, id: String(cat._id), children: [] }]));
  const roots = [];

  for (const cat of byId.values()) {
    const parentId = getParentId(cat);
    if (parentId && byId.has(parentId)) {
      byId.get(parentId).children.push(cat);
    } else {
      roots.push(cat);
    }
  }

  const trimDepth = (nodes, depth) =>
    nodes.map((node) => ({
      ...node,
      children: depth < maxDepth ? trimDepth(node.children, depth + 1) : [],
    }));

  return trimDepth(roots, 1);
};
