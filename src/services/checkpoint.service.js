import httpStatus from 'http-status';
import ApiError from '../utils/ApiError.js';
import { CheckpointItem, CheckpointLog, CheckpointModule } from '../models/checkpoint.model.js';

/** Only this account can add, rename, or delete modules and checkpoints. */
const CHECKPOINT_OWNER_EMAIL = 'superadmin@addon.in';

/**
 * Whether the user may create, rename, or delete modules and checkpoints.
 * @param {{ email?: string }} user
 * @returns {boolean}
 */
const canManageStructure = (user) => user?.email?.trim().toLowerCase() === CHECKPOINT_OWNER_EMAIL;

/**
 * Any signed-in user may flip either sign-off switch.
 * @param {{ email?: string, _id?: string, id?: string }} user
 * @returns {boolean}
 */
const canSignOff = (user) => Boolean(user && (user.email || user._id || user.id));

/**
 * Display name stored on a sign-off and its log.
 * @param {{ name?: string, email?: string }} user
 * @returns {string}
 */
const actorName = (user) => (user?.name || user?.email || 'Unknown').trim();

/**
 * Next sort position inside an optional parent filter.
 * @param {import('mongoose').Model} Model
 * @param {object} [filter]
 * @returns {Promise<number>}
 */
const nextSortOrder = async (Model, filter = {}) => {
  const last = await Model.findOne(filter).sort({ sortOrder: -1 }).select('sortOrder').lean();
  return (last?.sortOrder ?? 0) + 1;
};

/**
 * Checkpoint is complete only when both teams have signed off.
 * @param {{ developerChecked?: boolean, addonChecked?: boolean }} item
 * @returns {boolean}
 */
const isItemComplete = (item) => Boolean(item.developerChecked && item.addonChecked);

/**
 * @param {import('mongoose').Document} item
 * @returns {object}
 */
const serializeItem = (item) => ({
  ...item.toJSON(),
  complete: isItemComplete(item),
});

/**
 * Reject structure edits from anyone other than superadmin@addon.in.
 * @param {{ email?: string }} user
 */
const assertCanManage = (user) => {
  if (!canManageStructure(user)) {
    throw new ApiError(httpStatus.FORBIDDEN, 'Only superadmin@addon.in can add, rename, or delete checkpoints');
  }
};

/**
 * @param {string} moduleId
 * @returns {Promise<import('mongoose').Document>}
 */
const getModuleOrThrow = async (moduleId) => {
  const moduleDoc = await CheckpointModule.findById(moduleId);
  if (!moduleDoc) throw new ApiError(httpStatus.NOT_FOUND, 'Module not found');
  return moduleDoc;
};

/**
 * @param {string} itemId
 * @returns {Promise<import('mongoose').Document>}
 */
const getItemOrThrow = async (itemId) => {
  const item = await CheckpointItem.findById(itemId);
  if (!item) throw new ApiError(httpStatus.NOT_FOUND, 'Checkpoint not found');
  return item;
};

/**
 * Modules with their checkpoints and computed complete flags.
 * @returns {Promise<{ modules: object[] }>}
 */
const listCheckpoints = async () => {
  const modules = await CheckpointModule.find().sort({ sortOrder: 1, createdAt: 1 });
  const items = await CheckpointItem.find().sort({ sortOrder: 1, createdAt: 1 });
  const itemsByModule = new Map();

  items.forEach((item) => {
    const key = item.moduleId.toString();
    const bucket = itemsByModule.get(key) || [];
    bucket.push(serializeItem(item));
    itemsByModule.set(key, bucket);
  });

  return {
    modules: modules.map((moduleDoc) => {
      const moduleItems = itemsByModule.get(moduleDoc._id.toString()) || [];
      return {
        ...moduleDoc.toJSON(),
        complete: moduleItems.length > 0 && moduleItems.every((item) => item.complete),
        items: moduleItems,
      };
    }),
  };
};

/**
 * @param {{ name: string }} body
 * @param {{ _id: string, id?: string, role?: string, email?: string }} user
 * @returns {Promise<object>}
 */
const createModule = async (body, user) => {
  assertCanManage(user);
  const moduleDoc = await CheckpointModule.create({
    name: body.name.trim(),
    sortOrder: await nextSortOrder(CheckpointModule),
    createdBy: user._id || user.id,
  });
  return { ...moduleDoc.toJSON(), complete: false, items: [] };
};

/**
 * @param {string} moduleId
 * @param {{ name: string }} body
 * @param {{ role?: string, email?: string }} user
 * @returns {Promise<object>}
 */
const updateModule = async (moduleId, body, user) => {
  assertCanManage(user);
  const moduleDoc = await getModuleOrThrow(moduleId);
  moduleDoc.name = body.name.trim();
  await moduleDoc.save();
  return moduleDoc.toJSON();
};

/**
 * Deletes a module and every checkpoint and log under it.
 * @param {string} moduleId
 * @param {{ role?: string, email?: string }} user
 * @returns {Promise<void>}
 */
const deleteModule = async (moduleId, user) => {
  assertCanManage(user);
  const moduleDoc = await getModuleOrThrow(moduleId);
  const items = await CheckpointItem.find({ moduleId: moduleDoc._id }).select('_id');
  const itemIds = items.map((item) => item._id);
  await CheckpointLog.deleteMany({ $or: [{ moduleId: moduleDoc._id }, { itemId: { $in: itemIds } }] });
  await CheckpointItem.deleteMany({ moduleId: moduleDoc._id });
  await moduleDoc.deleteOne();
};

/**
 * @param {string} moduleId
 * @param {{ title: string, description?: string }} body
 * @param {{ role?: string, email?: string }} user
 * @returns {Promise<object>}
 */
const createItem = async (moduleId, body, user) => {
  assertCanManage(user);
  const moduleDoc = await getModuleOrThrow(moduleId);
  const item = await CheckpointItem.create({
    moduleId: moduleDoc._id,
    title: body.title.trim(),
    description: (body.description || '').trim(),
    sortOrder: await nextSortOrder(CheckpointItem, { moduleId: moduleDoc._id }),
  });
  return serializeItem(item);
};

/**
 * @param {string} itemId
 * @param {{ title: string, description?: string }} body
 * @param {{ role?: string, email?: string }} user
 * @returns {Promise<object>}
 */
const updateItem = async (itemId, body, user) => {
  assertCanManage(user);
  const item = await getItemOrThrow(itemId);
  item.title = body.title.trim();
  item.description = (body.description || '').trim();
  await item.save();
  return serializeItem(item);
};

/**
 * @param {string} itemId
 * @param {{ role?: string, email?: string }} user
 * @returns {Promise<void>}
 */
const deleteItem = async (itemId, user) => {
  assertCanManage(user);
  const item = await getItemOrThrow(itemId);
  await CheckpointLog.deleteMany({ itemId: item._id });
  await item.deleteOne();
};

/**
 * Apply one side of a sign-off and append a log. Same value is a no-op.
 * @param {import('mongoose').Document} item
 * @param {'developer' | 'addon'} column
 * @param {boolean} checked
 * @param {{ _id: string, id?: string, name?: string, email?: string }} user
 * @returns {Promise<void>}
 */
const applySignOff = async (item, column, checked, user) => {
  const prefix = column === 'developer' ? 'developer' : 'addon';
  const checkedKey = `${prefix}Checked`;
  if (Boolean(item[checkedKey]) === checked) return;

  const previous = {
    checked: item[checkedKey],
    by: item[`${prefix}CheckedBy`],
    name: item[`${prefix}CheckedByName`],
    at: item[`${prefix}CheckedAt`],
  };

  item[checkedKey] = checked;
  item[`${prefix}CheckedBy`] = checked ? user._id || user.id : null;
  item[`${prefix}CheckedByName`] = checked ? actorName(user) : '';
  item[`${prefix}CheckedAt`] = checked ? new Date() : null;
  await item.save();

  try {
    await CheckpointLog.create({
      itemId: item._id,
      moduleId: item.moduleId,
      column,
      checked,
      user: user._id || user.id,
      userName: actorName(user),
      actedAt: new Date(),
    });
  } catch (error) {
    item[checkedKey] = previous.checked;
    item[`${prefix}CheckedBy`] = previous.by;
    item[`${prefix}CheckedByName`] = previous.name;
    item[`${prefix}CheckedAt`] = previous.at;
    try {
      await item.save();
    } catch (revertError) {
      const reason = revertError instanceof Error ? revertError.message : 'unknown error';
      throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, `Sign-off log failed and could not be reverted: ${reason}`);
    }
    throw error;
  }
};

/**
 * Flip Developer or Addon sign-off. Any signed-in user can change either switch.
 * @param {string} itemId
 * @param {{ column: 'developer' | 'addon', checked: boolean }} body
 * @param {{ _id: string, id?: string, role?: string, email?: string, name?: string }} user
 * @returns {Promise<object>}
 */
const signOffItem = async (itemId, body, user) => {
  if (!canSignOff(user)) {
    throw new ApiError(httpStatus.FORBIDDEN, 'Sign in to change a sign-off');
  }
  const item = await getItemOrThrow(itemId);
  await applySignOff(item, body.column, body.checked, user);
  return serializeItem(item);
};

/**
 * Sign-off history for one checkpoint, newest first.
 * @param {string} itemId
 * @returns {Promise<object[]>}
 */
const listItemLogs = async (itemId) => {
  await getItemOrThrow(itemId);
  const logs = await CheckpointLog.find({ itemId }).sort({ actedAt: -1, createdAt: -1 });
  return logs.map((log) => log.toJSON());
};

export {
  listCheckpoints,
  createModule,
  updateModule,
  deleteModule,
  createItem,
  updateItem,
  deleteItem,
  signOffItem,
  listItemLogs,
};
