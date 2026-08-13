import {
  EMPTY_CRUD,
  FULL_CRUD,
  CRUD_KEYS,
  normalizeCrud,
  normalizeHelpSupport,
  normalizeNavigationTree,
  applyCrudTemplate,
  mergeNavigation,
  hasCrudPermission,
  FULL_HELP_SUPPORT,
  EMPTY_HELP_SUPPORT,
  HELP_SUPPORT_TABS,
  hasHelpSupportHubAccess,
  hasHelpSupportTabAccess,
} from './permissionTypes.js';

export const CATALOG_MODULES = [
  'Items',
  'Categories',
  'Raw Material',
  'Processes',
  'Attributes',
  'Style Codes',
];

const buildCatalogDefaults = () =>
  Object.fromEntries(CATALOG_MODULES.map((key) => [key, { ...EMPTY_CRUD }]));

/**
 * Default navigation — every module has CRUD flags (all false).
 */
export const DEFAULT_NAVIGATION = {
  Dashboard: { ...EMPTY_CRUD },
  Catalog: buildCatalogDefaults(),
  Users: { ...EMPTY_CRUD },
  'Help & Support': { ...FULL_HELP_SUPPORT },
};

const adminTemplate = applyCrudTemplate(DEFAULT_NAVIGATION, FULL_CRUD);

export const ROLE_NAVIGATION_TEMPLATES = {
  super_admin: { ...adminTemplate, 'Help & Support': { ...FULL_HELP_SUPPORT } },
  admin: { ...adminTemplate, 'Help & Support': { ...FULL_HELP_SUPPORT } },
  accounts: {
    Dashboard: { create: false, read: true, update: false, delete: false },
    Catalog: Object.fromEntries(
      CATALOG_MODULES.map((key) => [
        key,
        key === 'Items'
          ? { create: false, read: true, update: false, delete: false }
          : { ...EMPTY_CRUD },
      ])
    ),
    Users: { ...EMPTY_CRUD },
    'Help & Support': { ...FULL_HELP_SUPPORT },
  },
  user: {
    Dashboard: { create: false, read: true, update: false, delete: false },
    Catalog: Object.fromEntries(
      CATALOG_MODULES.map((key) => [
        key,
        key === 'Items'
          ? { create: false, read: true, update: false, delete: false }
          : { ...EMPTY_CRUD },
      ])
    ),
    Users: { ...EMPTY_CRUD },
    'Help & Support': { ...FULL_HELP_SUPPORT },
  },
};

/**
 * @param {string} role
 * @returns {object}
 */
export const getDefaultNavigationByRole = (role) => {
  const template = ROLE_NAVIGATION_TEMPLATES[role];
  if (!template) {
    return { ...normalizeNavigationTree(DEFAULT_NAVIGATION), 'Help & Support': { ...EMPTY_HELP_SUPPORT } };
  }
  const merged = mergeNavigation(DEFAULT_NAVIGATION, template);
  merged['Help & Support'] = normalizeHelpSupport(template['Help & Support'] ?? merged['Help & Support']);
  return merged;
};

const isCrudObject = (value) =>
  value && typeof value === 'object' && CRUD_KEYS.some((key) => key in value);

const validateCrudNode = (node, path) => {
  if (!isCrudObject(node)) {
    console.error(`Validation failed: ${path} is not a CRUD object`);
    return false;
  }
  for (const key of CRUD_KEYS) {
    if (typeof node[key] !== 'boolean') {
      console.error(`Validation failed: ${path}.${key} must be boolean`);
      return false;
    }
  }
  return true;
};

/**
 * @param {object} navigation
 * @returns {boolean}
 */
export const validateNavigationStructure = (navigation) => {
  if (!navigation || typeof navigation !== 'object') {
    return false;
  }

  const requiredTop = ['Dashboard', 'Catalog', 'Users'];
  for (const key of requiredTop) {
    if (!(key in navigation)) {
      console.error(`Validation failed: missing ${key}`);
      return false;
    }
  }

  if (!validateCrudNode(navigation.Dashboard, 'Dashboard')) {
    return false;
  }

  if (!validateCrudNode(navigation.Users, 'Users')) {
    return false;
  }

  if (!navigation.Catalog || typeof navigation.Catalog !== 'object') {
    console.error('Validation failed: Catalog must be an object');
    return false;
  }

  for (const moduleKey of CATALOG_MODULES) {
    if (!validateCrudNode(navigation.Catalog[moduleKey], `Catalog.${moduleKey}`)) {
      return false;
    }
  }

  if ('Help & Support' in navigation) {
    const hs = normalizeHelpSupport(navigation['Help & Support']);
    if (typeof hs.enabled !== 'boolean') {
      console.error('Validation failed: Help & Support.enabled must be boolean');
      return false;
    }
    for (const tab of HELP_SUPPORT_TABS) {
      if (typeof hs[tab] !== 'boolean') {
        console.error(`Validation failed: Help & Support.${tab} must be boolean`);
        return false;
      }
    }
    navigation['Help & Support'] = hs;
  }

  return true;
};

export {
  EMPTY_CRUD,
  FULL_CRUD,
  normalizeCrud,
  normalizeHelpSupport,
  normalizeNavigationTree,
  mergeNavigation,
  hasCrudPermission,
  FULL_HELP_SUPPORT,
  EMPTY_HELP_SUPPORT,
  hasHelpSupportHubAccess,
  hasHelpSupportTabAccess,
};
