/** CRUD permission shape used at every navigation level. */
export const EMPTY_CRUD = Object.freeze({
  create: false,
  read: false,
  update: false,
  delete: false,
});

export const FULL_CRUD = Object.freeze({
  create: true,
  read: true,
  update: true,
  delete: true,
});

export const CRUD_KEYS = ['create', 'read', 'update', 'delete'];

/**
 * @param {boolean|object} value
 * @returns {object}
 */
export const normalizeCrud = (value) => {
  if (value === true) {
    return { ...FULL_CRUD };
  }
  if (value === false || value == null) {
    return { ...EMPTY_CRUD };
  }
  if (typeof value === 'object') {
    return {
      create: Boolean(value.create),
      read: Boolean(value.read),
      update: Boolean(value.update),
      delete: Boolean(value.delete),
    };
  }
  return { ...EMPTY_CRUD };
};

export const applyCrudDependencies = (crud) => {
  const next = normalizeCrud(crud);
  if (next.create || next.update || next.delete) {
    next.read = true;
  }
  if (!next.read) {
    return { ...EMPTY_CRUD };
  }
  return next;
};

/**
 * Deep-clone a navigation tree, normalizing every leaf to CRUD objects.
 * @param {object} node
 * @returns {object}
 */
export const normalizeNavigationTree = (node) => {
  if (node == null || typeof node !== 'object' || Array.isArray(node)) {
    return { ...EMPTY_CRUD };
  }

  const keys = Object.keys(node);
  const looksLikeCrud = keys.some((k) => CRUD_KEYS.includes(k));

  if (looksLikeCrud) {
    return applyCrudDependencies(normalizeCrud(node));
  }

  const result = {};
  for (const key of keys) {
    result[key] = normalizeNavigationTree(node[key]);
  }
  return result;
};

/**
 * Apply a CRUD template recursively (boolean or CRUD object at each leaf).
 * @param {object} template
 * @param {object} crudTemplate
 * @returns {object}
 */
export const applyCrudTemplate = (template, crudTemplate) => {
  const crud = normalizeCrud(crudTemplate);
  const result = {};

  for (const key of Object.keys(template)) {
    const value = template[key];
    if (value && typeof value === 'object' && !CRUD_KEYS.some((k) => k in value)) {
      result[key] = applyCrudTemplate(value, crudTemplate);
    } else {
      result[key] = { ...crud };
    }
  }
  return result;
};

/**
 * Merge navigation trees; incoming CRUD flags override target.
 * @param {object} target
 * @param {object} source
 * @returns {object}
 */
export const mergeNavigation = (target, source) => {
  const normalizedTarget = normalizeNavigationTree(target || {});
  const normalizedSource = normalizeNavigationTree(source || {});
  const result = { ...normalizedTarget };

  for (const key of Object.keys(normalizedSource)) {
    const sourceValue = normalizedSource[key];
    const targetValue = result[key];

    const sourceIsCrud = CRUD_KEYS.some((k) => k in sourceValue);
    const targetIsCrud = targetValue && CRUD_KEYS.some((k) => k in targetValue);

    if (sourceIsCrud && targetIsCrud) {
      result[key] = applyCrudDependencies({ ...targetValue, ...sourceValue });
    } else if (sourceIsCrud && !targetIsCrud) {
      result[key] = applyCrudDependencies(sourceValue);
    } else if (!sourceIsCrud && targetIsCrud) {
      result[key] = mergeNavigation({ ...EMPTY_CRUD }, sourceValue);
    } else {
      result[key] = mergeNavigation(targetValue || {}, sourceValue);
    }
  }

  return result;
};

/**
 * Check CRUD permission at dot path (e.g. Catalog.Items).
 * @param {object} navigation
 * @param {string} path
 * @param {'create'|'read'|'update'|'delete'} action
 * @returns {boolean}
 */
export const hasCrudPermission = (navigation, path, action) => {
  const keys = path.split('.');
  let current = navigation;

  for (const key of keys) {
    if (!current || typeof current !== 'object') {
      return false;
    }
    current = current[key];
  }

  const crud = applyCrudDependencies(normalizeCrud(current));
  return Boolean(crud[action]);
};
