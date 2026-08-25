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
  FABRIC_LOOKUP_MODULES,
} from './permissionTypes.js';

export const CATALOG_MODULES = [
  'Items',
  'Category',
  'Style codes',
  'Fabric master',
  'Fabric Type',
  'Fabric Color',
  'Fabric Quality',
  'Fabric Yarn/Count',
  'Fabric Measurement',
  'Fabric Suppliers',
  'Packaging materials',
  'Process Master',
  'Attributes Master',
  'Machines & Configuration',
  'Workers / Operators',
  'Storage Racks',
  'Containers Master',
  'Label Templates & Device Registry',
];

export const CATALOG_KEY_ALIASES = {
  Categories: 'Category',
  'Style Codes': 'Style codes',
  'Raw Material': 'Packaging materials',
  Processes: 'Process Master',
  Attributes: 'Attributes Master',
};

export { FABRIC_LOOKUP_MODULES };

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
adminTemplate['Help & Support'] = true;

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

/**
 * Normalize incoming navigation: map legacy Catalog keys onto current modules.
 * @param {object} navigation
 * @returns {object}
 */
export const migrateCatalogNavigation = (navigation) => {
  if (!navigation || typeof navigation !== 'object') {
    return navigation;
  }
  const catalog = { ...(navigation.Catalog || {}) };
  for (const [legacy, next] of Object.entries(CATALOG_KEY_ALIASES)) {
    const hasNew =
      catalog[next] &&
      typeof catalog[next] === 'object' &&
      (catalog[next].create || catalog[next].read || catalog[next].update || catalog[next].delete);
    if (!hasNew && catalog[legacy] != null) {
      catalog[next] = catalog[legacy];
    }
    delete catalog[legacy];
  }
  // Drop unknown catalog keys that are not current modules
  const cleaned = {};
  for (const key of CATALOG_MODULES) {
    cleaned[key] = catalog[key] != null ? catalog[key] : { ...EMPTY_CRUD };
  }

  const fabricMaster = cleaned['Fabric master'];
  for (const key of FABRIC_LOOKUP_MODULES) {
    const current = cleaned[key];
    const hasOwn =
      current &&
      typeof current === 'object' &&
      (current.create || current.read || current.update || current.delete);
    if (
      !hasOwn &&
      fabricMaster &&
      typeof fabricMaster === 'object' &&
      (fabricMaster.create || fabricMaster.read || fabricMaster.update || fabricMaster.delete)
    ) {
      cleaned[key] = { ...fabricMaster };
    }
  }

  return { ...navigation, Catalog: cleaned };
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

  const migrated = migrateCatalogNavigation(navigation);

  const requiredTop = ['Dashboard', 'Catalog', 'Users'];
  for (const key of requiredTop) {
    if (!(key in migrated)) {
      console.error(`Validation failed: missing ${key}`);
      return false;
    }
  }

  if (!validateCrudNode(migrated.Dashboard, 'Dashboard')) {
    return false;
  }

  if (!validateCrudNode(migrated.Users, 'Users')) {
    return false;
  }

  if (!migrated.Catalog || typeof migrated.Catalog !== 'object') {
    console.error('Validation failed: Catalog must be an object');
    return false;
  }

  for (const moduleKey of CATALOG_MODULES) {
    if (!validateCrudNode(migrated.Catalog[moduleKey], `Catalog.${moduleKey}`)) {
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
      if (!validateCrudNode(hs[tab], `Help & Support.${tab}`)) {
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
