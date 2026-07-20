import httpStatus from 'http-status';
import ApiError from '../utils/ApiError.js';
import User from '../models/user.model.js';
import {
  DEFAULT_NAVIGATION,
  getDefaultNavigationByRole,
  mergeNavigation,
  validateNavigationStructure,
  normalizeNavigationTree,
} from '../utils/navigationHelper.js';

const createUser = async (userBody) => {
  if (await User.isEmailTaken(userBody.email)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Email already taken');
  }

  if (!userBody.navigation) {
    userBody.navigation = getDefaultNavigationByRole(userBody.role || 'user');
  } else {
    userBody.navigation = mergeNavigation(
      getDefaultNavigationByRole(userBody.role || 'user'),
      normalizeNavigationTree(userBody.navigation)
    );
    if (!validateNavigationStructure(userBody.navigation)) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid navigation structure');
    }
  }

  return User.create(userBody);
};

const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const queryUsers = async (filter, options) => {
  const { search, name, role, ...rest } = filter;
  const mongoFilter = { ...rest };

  if (name) mongoFilter.name = { $regex: escapeRegex(name), $options: 'i' };
  if (role) mongoFilter.role = role;

  if (search?.trim()) {
    const term = escapeRegex(search.trim());
    mongoFilter.$or = [
      { name: { $regex: term, $options: 'i' } },
      { email: { $regex: term, $options: 'i' } },
    ];
  }

  return User.paginate(mongoFilter, options);
};

const getUserById = async (id) => User.findById(id);

const getUserByEmail = async (email) => User.findOne({ email });

const updateUserById = async (userId, updateBody) => {
  const user = await getUserById(userId);
  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, 'User not found');
  }
  if (updateBody.email && (await User.isEmailTaken(updateBody.email, userId))) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Email already taken');
  }

  if (updateBody.navigation) {
    updateBody.navigation = mergeNavigation(
      getDefaultNavigationByRole(user.role || 'user'),
      normalizeNavigationTree(updateBody.navigation)
    );
    if (!validateNavigationStructure(updateBody.navigation)) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid navigation structure');
    }
  }

  Object.assign(user, updateBody);
  await user.save();
  return user;
};

const updateUserNavigationById = async (userId, navigationBody) => {
  const user = await getUserById(userId);
  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, 'User not found');
  }

  const updatedNavigation = mergeNavigation(
    mergeNavigation(JSON.parse(JSON.stringify(DEFAULT_NAVIGATION)), user.navigation || {}),
    navigationBody.navigation
  );

  if (!validateNavigationStructure(updatedNavigation)) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid navigation structure');
  }

  user.navigation = updatedNavigation;
  await user.save();
  return user;
};

const deleteUserById = async (userId) => {
  const user = await getUserById(userId);
  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, 'User not found');
  }
  await user.remove();
  return user;
};

export {
  createUser,
  queryUsers,
  getUserById,
  getUserByEmail,
  updateUserById,
  updateUserNavigationById,
  deleteUserById,
};
