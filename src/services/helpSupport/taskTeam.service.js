import httpStatus from 'http-status';
import ApiError from '../../utils/ApiError.js';
import HelpSupportTaskTeam from '../../models/helpSupport/taskTeam.model.js';
import { isHelpSupportSuperAdmin } from '../../utils/collaborationRole.util.js';

const DEFAULT_TEAMS = [
  {
    slug: 'management',
    name: 'Management',
    description: 'Accounts, admin, and management users',
    roles: ['accounts', 'admin', 'super_admin'],
    sortOrder: 1,
    isActive: true,
  },
  {
    slug: 'dev_team',
    name: 'Dev Team',
    description: 'Development and operations users',
    roles: ['user'],
    sortOrder: 2,
    isActive: true,
  },
];

const activeTeamFilter = {
  $or: [{ isActive: true }, { isActive: { $exists: false } }],
};

const ensureDefaultTeams = async () => {
  for (const team of DEFAULT_TEAMS) {
    await HelpSupportTaskTeam.updateOne({ slug: team.slug }, { $setOnInsert: team }, { upsert: true });
  }
  await HelpSupportTaskTeam.updateMany(
    { slug: { $in: DEFAULT_TEAMS.map((t) => t.slug) }, isActive: { $exists: false } },
    { $set: { isActive: true } }
  );
};

const listTeams = async (includeInactive = false) => {
  await ensureDefaultTeams();
  const filter = includeInactive ? {} : activeTeamFilter;
  return HelpSupportTaskTeam.find(filter).sort({ sortOrder: 1, name: 1 });
};

const createTeam = async (body, user) => {
  if (!isHelpSupportSuperAdmin(user)) {
    throw new ApiError(httpStatus.FORBIDDEN, 'Only super admin can manage teams');
  }
  const slug = String(body.slug || body.name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
  if (!slug) throw new ApiError(httpStatus.BAD_REQUEST, 'Team slug is required');

  const exists = await HelpSupportTaskTeam.findOne({ slug });
  if (exists) throw new ApiError(httpStatus.BAD_REQUEST, 'Team slug already exists');

  return HelpSupportTaskTeam.create({
    slug,
    name: body.name.trim(),
    description: body.description?.trim() || '',
    roles: Array.isArray(body.roles) ? body.roles.map((r) => String(r).trim().toLowerCase()) : [],
    sortOrder: body.sortOrder ?? 99,
    isActive: body.isActive !== false,
  });
};

const updateTeam = async (teamId, body, user) => {
  if (!isHelpSupportSuperAdmin(user)) {
    throw new ApiError(httpStatus.FORBIDDEN, 'Only super admin can manage teams');
  }
  const team = await HelpSupportTaskTeam.findById(teamId);
  if (!team) throw new ApiError(httpStatus.NOT_FOUND, 'Team not found');

  if (body.name !== undefined) team.name = body.name.trim();
  if (body.description !== undefined) team.description = body.description.trim();
  if (body.roles !== undefined) {
    team.roles = Array.isArray(body.roles) ? body.roles.map((r) => String(r).trim().toLowerCase()) : [];
  }
  if (body.sortOrder !== undefined) team.sortOrder = body.sortOrder;
  if (body.isActive !== undefined) team.isActive = Boolean(body.isActive);

  await team.save();
  return team;
};

const getTeamsForRole = async (role) => {
  await ensureDefaultTeams();
  const normalized = role ? String(role).trim().toLowerCase().replace(/\s+/g, '_') : '';
  if (!normalized) return [];
  const teams = await HelpSupportTaskTeam.find({ ...activeTeamFilter, roles: normalized });
  return teams.map((t) => t.slug);
};

export { listTeams, createTeam, updateTeam, ensureDefaultTeams, getTeamsForRole };
