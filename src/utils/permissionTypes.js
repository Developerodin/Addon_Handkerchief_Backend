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

export const FABRIC_LOOKUP_MODULES = [
  'Fabric Type',
  'Fabric Color',
  'Fabric Quality',
  'Fabric Yarn/Count',
  'Fabric Measurement',
];

export const HELP_SUPPORT_TABS = ['Files', 'Tasks', 'Tickets'];

export const FULL_HELP_SUPPORT = Object.freeze({
  enabled: true,
  Files: { ...FULL_CRUD },
  Tasks: { ...FULL_CRUD },
  Tickets: { ...FULL_CRUD },
});

export const EMPTY_HELP_SUPPORT = Object.freeze({
  enabled: false,
  Files: { ...EMPTY_CRUD },
  Tasks: { ...EMPTY_CRUD },
  Tickets: { ...EMPTY_CRUD },
});

/**
 * @param {boolean|object|null|undefined} value
 * @returns {object}
 */
const normalizeHelpSupportTab = (value) => {
  if (value === true) {
    return { ...FULL_CRUD };
  }
  if (value === false || value == null) {
    return { ...EMPTY_CRUD };
  }
  return applyCrudDependencies(normalizeCrud(value));
};

/**
 * @param {boolean|object|null|undefined} value
 */
export const normalizeHelpSupport = (value) => {
  if (value === true) {
    return { ...FULL_HELP_SUPPORT };
  }
  if (value === false || value == null) {
    return { ...EMPTY_HELP_SUPPORT };
  }
  if (typeof value === 'object') {
    const enabled = Boolean(value.enabled);
    if (!enabled) {
      return { ...EMPTY_HELP_SUPPORT };
    }
    return {
      enabled: true,
      Files: normalizeHelpSupportTab(value.Files),
      Tasks: normalizeHelpSupportTab(value.Tasks),
      Tickets: normalizeHelpSupportTab(value.Tickets),
    };
  }
  return { ...EMPTY_HELP_SUPPORT };
};

const HUB_TAB_SLUG_TO_KEY = {
  files: 'Files',
  tasks: 'Tasks',
  tickets: 'Tickets',
};

/**
 * Whether Help & Support hub is enabled with at least one tab read.
 * @param {object|boolean|null|undefined} value
 * @returns {boolean}
 */
export const hasHelpSupportHubAccess = (value) => {
  const hs = normalizeHelpSupport(value);
  return hs.enabled && HELP_SUPPORT_TABS.some((tab) => hs[tab].read);
};

/**
 * Whether a specific Help & Support tab is allowed.
 * @param {object|boolean|null|undefined} value
 * @param {'files'|'tasks'|'tickets'} tabSlug
 * @returns {boolean}
 */
export const hasHelpSupportTabAccess = (value, tabSlug) => {
  const hs = normalizeHelpSupport(value);
  if (!hs.enabled) return false;
  const key = HUB_TAB_SLUG_TO_KEY[tabSlug];
  if (!key) return false;
  return Boolean(hs[key].read);
};

const mergeHelpSupportTab = (targetTab, sourceTab) => {
  const target = normalizeHelpSupportTab(targetTab);
  if (sourceTab == null) return target;
  const source = normalizeHelpSupportTab(sourceTab);
  return applyCrudDependencies({ ...target, ...source });
};

const mergeHelpSupport = (target, source) => {
  const normalizedTarget = normalizeHelpSupport(target);
  if (source == null) return normalizedTarget;

  if (typeof source === 'boolean') {
    return normalizeHelpSupport(source);
  }

  const normalizedSource = normalizeHelpSupport(source);
  const enabled =
    Object.prototype.hasOwnProperty.call(source, 'enabled') ? normalizedSource.enabled : normalizedTarget.enabled;

  if (!enabled) {
    return { ...EMPTY_HELP_SUPPORT };
  }

  return {
    enabled: true,
    Files: Object.prototype.hasOwnProperty.call(source, 'Files')
      ? mergeHelpSupportTab(normalizedTarget.Files, source.Files)
      : normalizedTarget.Files,
    Tasks: Object.prototype.hasOwnProperty.call(source, 'Tasks')
      ? mergeHelpSupportTab(normalizedTarget.Tasks, source.Tasks)
      : normalizedTarget.Tasks,
    Tickets: Object.prototype.hasOwnProperty.call(source, 'Tickets')
      ? mergeHelpSupportTab(normalizedTarget.Tickets, source.Tickets)
      : normalizedTarget.Tickets,
  };
};

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
  if (typeof node === 'boolean') {
    return node;
  }
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
    if (key === 'Help & Support') {
      result[key] = normalizeHelpSupport(node[key]);
    } else {
      result[key] = normalizeNavigationTree(node[key]);
    }
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
    if (key === 'Help & Support') {
      result[key] = normalizeHelpSupport(template[key]);
      continue;
    }
    const value = template[key];
    if (typeof value === 'boolean') {
      result[key] = value;
    } else if (value && typeof value === 'object' && !CRUD_KEYS.some((k) => k in value)) {
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

  result['Help & Support'] = mergeHelpSupport(
    target?.['Help & Support'] ?? normalizedTarget['Help & Support'],
    source?.['Help & Support'] ?? normalizedSource['Help & Support']
  );

  for (const key of Object.keys(normalizedSource)) {
    if (key === 'Help & Support') continue;
    const sourceValue = normalizedSource[key];
    const targetValue = result[key];

    const sourceIsCrud =
      sourceValue && typeof sourceValue === 'object' && CRUD_KEYS.some((k) => k in sourceValue);
    const targetIsCrud =
      targetValue && typeof targetValue === 'object' && CRUD_KEYS.some((k) => k in targetValue);

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
 * Check CRUD permission at dot path (e.g. Catalog.Items or Help & Support.Files).
 * @param {object} navigation
 * @param {string} path
 * @param {'create'|'read'|'update'|'delete'} action
 * @returns {boolean}
 */
export const hasCrudPermission = (navigation, path, action) => {
  const keys = path.split('.');

  if (keys[0] === 'Help & Support') {
    const hs = normalizeHelpSupport(navigation?.['Help & Support']);
    if (!hs.enabled) return false;
    if (keys.length === 1) {
      return HELP_SUPPORT_TABS.some((tab) => hs[tab][action]);
    }
    const tab = keys[1];
    if (!HELP_SUPPORT_TABS.includes(tab)) return false;
    const crud = applyCrudDependencies(normalizeCrud(hs[tab]));
    return Boolean(crud[action]);
  }

  let current = navigation;

  for (const key of keys) {
    if (!current || typeof current !== 'object') {
      return false;
    }
    current = current[key];
  }

  const crud = applyCrudDependencies(normalizeCrud(current));

  if (
    keys[0] === 'Catalog' &&
    keys.length === 2 &&
    FABRIC_LOOKUP_MODULES.includes(keys[1])
  ) {
    const fabricMaster = navigation?.Catalog?.['Fabric master'];
    const fabricCrud = applyCrudDependencies(normalizeCrud(fabricMaster));
    return Boolean(crud[action] || fabricCrud[action]);
  }

  return Boolean(crud[action]);
};
