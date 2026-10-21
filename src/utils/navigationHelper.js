import {
  EMPTY_CRUD,
  FULL_CRUD,
  CRUD_KEYS,
  normalizeCrud,
  applyCrudDependencies,
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

export const FACTORY_SCREEN_KEYS = [
  'Sync',
  'Store / Purchase orders',
  'Store / Receipt',
  'Store / Racks and issue',
  'Production / Orders',
  'Production / Floor',
  'Production / Cut',
  'Production / Selvage',
  'Production / Half moon',
  'Production / Vertical hem',
  'Production / Bundle',
  'Production / Horizontal hem',
  'Production / Thread cut',
  'Production / Iron',
  'Production / Route split',
  'Production / Embroidery',
  'Production / Sticker',
  'Quality / Fabric QC',
  'Quality / Floor checks',
  'Quality / Grades',
  'Warehouse / Packing',
  'Warehouse / Boxes',
  'Warehouse / Orders',
  'Warehouse / Dispatch',
  'Accounts / Invoices',
  'Reports',
  'Fabric / Purchase orders',
  'Fabric / Drafts',
  'Fabric / Receipts',
  'Fabric / GRN history',
  'Fabric / Vendor return',
  'Fabric / Return challan',
  'Fabric / Issue',
  'Fabric / Return',
  'Fabric / Storage',
  'Fabric / Live inventory',
  'Fabric / Stock report',
  'Fabric / PO analytics',
  'Fabric / Fabric analytics',
];

/** Fill a new Fabric screen from the Store or Reports grant it used to share. */
const FABRIC_FROM_LEGACY = {
  'Fabric / Purchase orders': 'Store / Purchase orders',
  'Fabric / Drafts': 'Store / Purchase orders',
  'Fabric / Receipts': 'Store / Receipt',
  'Fabric / GRN history': 'Store / Receipt',
  'Fabric / Vendor return': 'Store / Receipt',
  'Fabric / Return challan': 'Store / Receipt',
  'Fabric / Issue': 'Store / Racks and issue',
  'Fabric / Return': 'Store / Racks and issue',
  'Fabric / Storage': 'Store / Racks and issue',
  'Production / Cut': 'Production / Floor',
  'Production / Selvage': 'Production / Floor',
  'Production / Half moon': 'Production / Floor',
  'Production / Vertical hem': 'Production / Floor',
  'Production / Bundle': 'Production / Floor',
  'Production / Horizontal hem': 'Production / Floor',
  'Production / Thread cut': 'Production / Floor',
  'Production / Iron': 'Production / Floor',
  'Production / Route split': 'Production / Floor',
  'Production / Embroidery': 'Production / Floor',
  'Production / Sticker': 'Production / Floor',
  'Fabric / Live inventory': 'Reports',
  'Fabric / Stock report': 'Reports',
  'Fabric / PO analytics': 'Reports',
  'Fabric / Fabric analytics': 'Reports',
};

export const CATALOG_MODULES = [
  'Items',
  'Category',
  'Style codes',
  'Fabric master',
  'Fabric Type',
  'Fabric Color',
  'Fabric Quality',
  'Fabric Yarn',
  'Fabric Count',
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
  'Revision review': { ...EMPTY_CRUD },
  ...Object.fromEntries(FACTORY_SCREEN_KEYS.map((key) => [key, { ...EMPTY_CRUD }])),
  'Help & Support': { ...FULL_HELP_SUPPORT },
};

const adminTemplate = applyCrudTemplate(DEFAULT_NAVIGATION, FULL_CRUD);
adminTemplate['Help & Support'] = true;

const superAdminTemplate = {
  ...adminTemplate,
  'Help & Support': { ...FULL_HELP_SUPPORT },
  'Revision review': { ...FULL_CRUD },
};
adminTemplate['Revision review'] = { ...EMPTY_CRUD };
for (const key of FACTORY_SCREEN_KEYS) {
  superAdminTemplate[key] = { ...FULL_CRUD };
  adminTemplate[key] = { ...EMPTY_CRUD };
}

export const ROLE_NAVIGATION_TEMPLATES = {
  super_admin: superAdminTemplate,
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
 * Role template fills keys the stored user document does not have yet.
 * Stored flags win, so an explicit deny stays denied.
 * @param {{ role?: string, navigation?: object } | null | undefined} user
 * @returns {object}
 */
export const effectiveNavigation = (user) => {
  const roleDefaults = getDefaultNavigationByRole(user?.role);
  const stored = user?.navigation || {};
  const merged = mergeNavigation(roleDefaults, stored);
  for (const [next, legacy] of Object.entries(FABRIC_FROM_LEGACY)) {
    if (stored[next] != null || stored[legacy] == null) continue;
    const legacyCrud = normalizeCrud(stored[legacy]);
    const granted = legacyCrud.create || legacyCrud.read || legacyCrud.update || legacyCrud.delete;
    if (granted) merged[next] = applyCrudDependencies(legacyCrud);
  }
  return merged;
};

/**
 * @param {string} role
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
