import httpStatus from 'http-status';
import ApiError from '../utils/ApiError.js';
import { hasCrudPermission } from '../utils/navigationHelper.js';

/**
 * Require a CRUD flag on the user's navigation tree (e.g. Catalog.Items + update).
 * Must run after auth() so req.user is populated.
 */
const requireCrud = (path, action) => (req, res, next) => {
  if (!req.user) {
    return next(new ApiError(httpStatus.UNAUTHORIZED, 'Please authenticate'));
  }

  const navigation = req.user.navigation;
  if (!hasCrudPermission(navigation, path, action)) {
    return next(new ApiError(httpStatus.FORBIDDEN, 'Forbidden'));
  }

  return next();
};

/**
 * Allow if any of the listed CRUD actions is granted on path.
 */
const requireAnyCrud = (path, actions) => (req, res, next) => {
  if (!req.user) {
    return next(new ApiError(httpStatus.UNAUTHORIZED, 'Please authenticate'));
  }

  const navigation = req.user.navigation;
  const allowed = actions.some((action) => hasCrudPermission(navigation, path, action));
  if (!allowed) {
    return next(new ApiError(httpStatus.FORBIDDEN, 'Forbidden'));
  }

  return next();
};

/**
 * Allow when the user has any of several path+action pairs.
 * Used for reference-data reads (e.g. style codes lookup while viewing items).
 */
const requireAnyCrudPath = (checks) => (req, res, next) => {
  if (!req.user) {
    return next(new ApiError(httpStatus.UNAUTHORIZED, 'Please authenticate'));
  }

  const navigation = req.user.navigation;
  const allowed = checks.some(({ path, action }) => hasCrudPermission(navigation, path, action));
  if (!allowed) {
    return next(new ApiError(httpStatus.FORBIDDEN, 'Forbidden'));
  }

  return next();
};

/** Items module users may read other catalog modules for lookups on item screens. */
const itemsReferenceRead = (modulePath) =>
  requireAnyCrudPath([
    { path: modulePath, action: 'read' },
    { path: 'Catalog.Items', action: 'read' },
  ]);

export { requireCrud, requireAnyCrud, requireAnyCrudPath, itemsReferenceRead };
