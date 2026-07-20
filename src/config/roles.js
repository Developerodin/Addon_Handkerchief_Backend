const basePermissions = ['getUsers'];

const adminPermissions = [...basePermissions, 'manageUsers', 'manageNavigation'];

const allRoles = {
  user: [],
  accounts: ['getUsers'],
  admin: adminPermissions,
  super_admin: [...adminPermissions, 'manageRoles'],
};

const roles = Object.keys(allRoles);
const roleRights = new Map(Object.entries(allRoles));

export { roles, roleRights };
