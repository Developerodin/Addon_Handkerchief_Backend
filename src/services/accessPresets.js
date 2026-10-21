const read = { create: false, read: true, update: false, delete: false };
const write = { create: true, read: true, update: true, delete: false };
const scan = { create: true, read: true, update: false, delete: false };

/**
 * Factory job presets. They fill navigation flags. They are not new role codes.
 * @param {string} name
 * @returns {Record<string, {create: boolean, read: boolean, update: boolean, delete: boolean}>}
 */
export const accessPreset = (name) => {
  const presets = {
    'head-office': {
      'Store / Purchase orders': write,
      'Production / Orders': write,
      'Warehouse / Orders': write,
      Reports: read,
    },
    accounts: {
      'Store / Purchase orders': { create: false, read: true, update: true, delete: false },
      'Accounts / Invoices': write,
      Reports: read,
    },
    store: {
      'Store / Receipt': write,
      'Store / Racks and issue': write,
      'Warehouse / Boxes': read,
    },
    qc: {
      'Quality / Fabric QC': write,
      'Quality / Floor checks': write,
      'Quality / Grades': read,
    },
    supervisor: {
      'Production / Orders': read,
      'Production / Floor': write,
      'Revision review': read,
      Reports: read,
    },
    operator: {
      'Production / Floor': scan,
    },
    packing: {
      'Warehouse / Packing': write,
    },
    dispatch: {
      'Warehouse / Boxes': write,
      'Warehouse / Dispatch': write,
    },
    management: {
      Reports: read,
      Dashboard: read,
      Sync: read,
    },
  };
  return presets[name] || {};
};
