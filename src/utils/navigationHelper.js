import {
  EMPTY_CRUD,
  FULL_CRUD,
  CRUD_KEYS,
  normalizeCrud,
  normalizeNavigationTree,
  applyCrudTemplate,
  mergeNavigation,
  hasCrudPermission,
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
};

const adminTemplate = applyCrudTemplate(DEFAULT_NAVIGATION, FULL_CRUD);

export const ROLE_NAVIGATION_TEMPLATES = {
  super_admin: adminTemplate,
  admin: adminTemplate,
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
  },
};

/**
 * @param {string} role
 * @returns {object}
 */
export const getDefaultNavigationByRole = (role) => {
  const template = ROLE_NAVIGATION_TEMPLATES[role];
  if (!template) {
    return normalizeNavigationTree(DEFAULT_NAVIGATION);
  }
  return mergeNavigation(DEFAULT_NAVIGATION, template);
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

  return true;
};

export {
  EMPTY_CRUD,
  FULL_CRUD,
  normalizeCrud,
  normalizeNavigationTree,
  mergeNavigation,
  hasCrudPermission,
};
