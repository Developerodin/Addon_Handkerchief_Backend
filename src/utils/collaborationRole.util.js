/** Super-admin email with full hub management access */
export const HELP_SUPPORT_SUPER_EMAIL = 'admin@addon.in';

/** Management side: accounts, admin, super_admin */
const MANAGEMENT_ROLES = new Set(['accounts', 'admin', 'super_admin']);

/** Dev team side */
const DEV_TEAM_ROLES = new Set(['user']);

/** Roles that can delete tickets */
const ADMIN_ROLES = new Set(['admin', 'super_admin']);

/**
 * Normalize role string (handles superadmin / casing variants).
 * @param {string} [role]
 * @returns {string|undefined}
 */
const normalizeRole = (role) => {
  if (!role) return undefined;
  const normalized = String(role).trim().toLowerCase().replace(/\s+/g, '_');
  if (normalized === 'superadmin') return 'super_admin';
  return normalized;
};

const isSuperSupportEmail = (user) =>
  user?.email?.trim().toLowerCase() === HELP_SUPPORT_SUPER_EMAIL;

export const isHelpSupportSuperAdmin = (user) => {
  if (isSuperSupportEmail(user)) return true;
  return normalizeRole(user?.role) === 'super_admin';
};

export { normalizeRole };

/**
 * Management side (formerly agent).
 * @param {{ role?: string, email?: string }} user
 * @returns {boolean}
 */
export const isManagement = (user) => {
  if (isSuperSupportEmail(user)) return true;
  const role = normalizeRole(user?.role);
  return Boolean(role && MANAGEMENT_ROLES.has(role));
};

/**
 * Dev team side.
 * @param {{ role?: string }} user
 * @returns {boolean}
 */
export const isDevTeam = (user) => {
  const role = normalizeRole(user?.role);
  return Boolean(role && DEV_TEAM_ROLES.has(role));
};

/** @deprecated use isManagement */
export const isHelpSupportAgent = isManagement;

/**
 * Whether the user may delete help & support tickets (super email only).
 * @param {{ email?: string }} user
 * @returns {boolean}
 */
export const canDeleteHelpSupportTicket = (user) => isSuperSupportEmail(user);

/**
 * Whether the user has full admin hub powers.
 * @param {{ role?: string, email?: string }} user
 * @returns {boolean}
 */
export const isHelpSupportAdmin = (user) => {
  if (isSuperSupportEmail(user)) return true;
  const role = normalizeRole(user?.role);
  return Boolean(role && ADMIN_ROLES.has(role));
};

/**
 * Whether the user raised the ticket.
 */
export const isTicketOwner = (user, ticket) => {
  if (!user?._id || !ticket?.raisedBy) return false;
  const ownerId = ticket.raisedBy._id ? ticket.raisedBy._id.toString() : ticket.raisedBy.toString();
  return user._id.toString() === ownerId;
};

/**
 * Whether the user may view a ticket.
 */
export const canViewTicket = (user, ticket) => isManagement(user) || isTicketOwner(user, ticket);

/**
 * Whether the user may create and assign tasks.
 */
export const canManageTasks = (user) => isManagement(user);

/**
 * Whether the user may view a task.
 */
export const canViewTask = (user, task) => {
  if (isManagement(user)) return true;

  const role = normalizeRole(user?.role);
  if (role && Array.isArray(task?.assignedTeams) && task.assignedTeams.length) {
    const teamSlugsForRole = {
      accounts: ['management'],
      admin: ['management'],
      super_admin: ['management'],
      user: ['dev_team'],
    };
    const allowed = teamSlugsForRole[role] || [];
    if (task.assignedTeams.some((slug) => allowed.includes(String(slug).toLowerCase()))) {
      return true;
    }
  }

  if (!user?._id || !task?.assignees?.length) return false;
  const userId = (user._id || user.id).toString();
  return task.assignees.some((a) => {
    const id = a._id ? a._id.toString() : a.toString();
    return id === userId;
  });
};

const HUB_API_RIGHTS = new Set([
  'getHelpSupportHub',
  'getHelpSupportTickets',
  'manageHelpSupportTickets',
  'getHelpSupportAnalytics',
  'deleteHelpSupportTickets',
  'manageHelpSupportTasks',
]);

/**
 * Grants hub API rights for management users when JWT role rights are stale.
 */
export const hasHelpSupportApiAccess = (user, requiredRights) => {
  if (!requiredRights.length || !requiredRights.every((r) => HUB_API_RIGHTS.has(r))) {
    return false;
  }
  if (requiredRights.includes('deleteHelpSupportTickets')) {
    return canDeleteHelpSupportTicket(user);
  }
  if (requiredRights.includes('manageHelpSupportTasks')) {
    return canManageTasks(user);
  }
  if (requiredRights.includes('getHelpSupportHub')) {
    return isManagement(user) || isDevTeam(user);
  }
  if (
    requiredRights.includes('manageHelpSupportTickets') ||
    requiredRights.includes('getHelpSupportAnalytics')
  ) {
    return isManagement(user);
  }
  if (requiredRights.includes('getHelpSupportTickets')) {
    return isManagement(user) || isDevTeam(user);
  }
  return isManagement(user);
};
