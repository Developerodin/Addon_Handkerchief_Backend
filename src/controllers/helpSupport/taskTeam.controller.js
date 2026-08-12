import httpStatus from 'http-status';
import catchAsync from '../../utils/catchAsync.js';
import * as taskTeamService from '../../services/helpSupport/taskTeam.service.js';

const listTeams = catchAsync(async (req, res) => {
  const includeInactive = req.query.includeInactive === 'true';
  const teams = await taskTeamService.listTeams(includeInactive);
  res.send({ results: teams });
});

const createTeam = catchAsync(async (req, res) => {
  const team = await taskTeamService.createTeam(req.body, req.user);
  res.status(httpStatus.CREATED).send(team);
});

const updateTeam = catchAsync(async (req, res) => {
  const team = await taskTeamService.updateTeam(req.params.teamId, req.body, req.user);
  res.send(team);
});

export { listTeams, createTeam, updateTeam };
