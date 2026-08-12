const hubBasePermissions = ['getHelpSupportHub', 'getHelpSupportTickets'];

const managementPermissions = [
  ...hubBasePermissions,
  'manageHelpSupportTickets',
  'getHelpSupportAnalytics',
  'manageHelpSupportTasks',
  'getUsers',
];

const adminPermissions = [...managementPermissions, 'manageUsers', 'manageNavigation', 'deleteHelpSupportTickets'];

const allRoles = {
  user: hubBasePermissions,
  accounts: managementPermissions,
  admin: adminPermissions,
  super_admin: [...adminPermissions, 'manageRoles'],
};

const roles = Object.keys(allRoles);
const roleRights = new Map(Object.entries(allRoles));

export { roles, roleRights };
