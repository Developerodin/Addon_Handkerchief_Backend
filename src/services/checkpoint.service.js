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
 * A stored boolean that was set on purpose, including an explicit false.
 * @param {boolean | null | undefined} value
 * @returns {boolean}
 */
const isExplicitBoolean = (value) => value === true || value === false;

/**
 * Checkbox value. An unset new flag falls back to the old Developer or Addon flag.
 * @param {object} item
 * @param {string} key - developed, testedOdin, or testedAddon
 * @param {string | null} legacyPrefix
 * @returns {{ checked: boolean, byName: string, at: Date | null }}
 */
const checkView = (item, key, legacyPrefix) => {
  const stored = item[`${key}Checked`];
  if (isExplicitBoolean(stored)) {
    return {
      checked: stored,
      byName: item[`${key}CheckedByName`] || '',
      at: item[`${key}CheckedAt`] || null,
    };
  }
  if (legacyPrefix && item[`${legacyPrefix}Checked`] === true) {
    return {
      checked: true,
      byName: item[`${legacyPrefix}CheckedByName`] || '',
      at: item[`${legacyPrefix}CheckedAt`] || null,
    };
  }
  return { checked: false, byName: '', at: null };
};

/**
 * Implemented is Yes, No, or still unset.
 * @param {boolean | null | undefined} value
 * @returns {boolean | null}
 */
const implementedView = (value) => (isExplicitBoolean(value) ? value : null);

/**
 * A row is complete when every check is on and Implemented is Yes.
 * @param {{ developedChecked: boolean, testedOdinChecked: boolean, testedAddonChecked: boolean, implemented: boolean | null }} item
 * @returns {boolean}
 */
const isItemComplete = (item) =>
  Boolean(item.developedChecked && item.testedOdinChecked && item.testedAddonChecked && item.implemented === true);

/**
 * @param {import('mongoose').Document} item
 * @returns {object}
 */
const serializeItem = (item) => {
  const developed = checkView(item, 'developed', 'developer');
  const testedOdin = checkView(item, 'testedOdin', null);
  const testedAddon = checkView(item, 'testedAddon', 'addon');
  const view = {
    developedChecked: developed.checked,
    developedCheckedByName: developed.byName,
    developedCheckedAt: developed.at,
    testedOdinChecked: testedOdin.checked,
    testedOdinCheckedByName: testedOdin.byName,
    testedOdinCheckedAt: testedOdin.at,
    testedAddonChecked: testedAddon.checked,
    testedAddonCheckedByName: testedAddon.byName,
    testedAddonCheckedAt: testedAddon.at,
    implemented: implementedView(item.implemented),
    implementedByName: item.implementedByName || '',
    implementedAt: item.implementedAt || null,
    pendencyRemark: item.pendencyRemark || '',
  };
  return {
    ...item.toJSON(),
    ...view,
    complete: isItemComplete(view),
  };
};

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

const COLUMN_KEYS = {
  developed: { value: 'developedChecked', by: 'developedCheckedBy', name: 'developedCheckedByName', at: 'developedCheckedAt' },
  testedOdin: { value: 'testedOdinChecked', by: 'testedOdinCheckedBy', name: 'testedOdinCheckedByName', at: 'testedOdinCheckedAt' },
  testedAddon: { value: 'testedAddonChecked', by: 'testedAddonCheckedBy', name: 'testedAddonCheckedByName', at: 'testedAddonCheckedAt' },
  implemented: { value: 'implemented', by: 'implementedBy', name: 'implementedByName', at: 'implementedAt' },
};

/**
 * Apply one spreadsheet column and append a log. The same value is a no-op.
 * @param {import('mongoose').Document} item
 * @param {'developed' | 'testedOdin' | 'testedAddon' | 'implemented'} column
 * @param {boolean} checked
 * @param {{ _id: string, id?: string, name?: string, email?: string }} user
 * @returns {Promise<void>}
 */
const applySignOff = async (item, column, checked, user) => {
  const keys = COLUMN_KEYS[column];
  const current = item[keys.value];
  if (isExplicitBoolean(current) && current === checked) return;

  const previous = {
    checked: current,
    by: item[keys.by],
    name: item[keys.name],
    at: item[keys.at],
  };

  item[keys.value] = checked;
  item[keys.by] = user._id || user.id;
  item[keys.name] = actorName(user);
  item[keys.at] = new Date();
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
    item[keys.value] = previous.checked;
    item[keys.by] = previous.by;
    item[keys.name] = previous.name;
    item[keys.at] = previous.at;
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
 * Sets one spreadsheet column. Any signed-in user can change any column.
 * @param {string} itemId
 * @param {{ column: 'developed' | 'testedOdin' | 'testedAddon' | 'implemented', checked: boolean }} body
 * @param {{ _id: string, id?: string, role?: string, email?: string, name?: string }} user
 * @returns {Promise<object>}
 */
const signOffItem = async (itemId, body, user) => {
  if (!canSignOff(user)) {
    throw new ApiError(httpStatus.FORBIDDEN, 'Sign in to change a sign-off');
  }
  if (!COLUMN_KEYS[body.column]) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Unknown checkpoint column');
  }
  const item = await getItemOrThrow(itemId);
  await applySignOff(item, body.column, body.checked, user);
  return serializeItem(item);
};

/**
 * Saves the pendency remark. Any signed-in user can edit it.
 * @param {string} itemId
 * @param {{ pendencyRemark?: string }} body
 * @param {{ email?: string, _id?: string, id?: string }} user
 * @returns {Promise<object>}
 */
const updateRemark = async (itemId, body, user) => {
  if (!canSignOff(user)) {
    throw new ApiError(httpStatus.FORBIDDEN, 'Sign in to change a sign-off');
  }
  const item = await getItemOrThrow(itemId);
  item.pendencyRemark = (body.pendencyRemark || '').trim();
  await item.save();
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
  updateRemark,
  listItemLogs,
};
