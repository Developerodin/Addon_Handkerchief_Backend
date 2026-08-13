import httpStatus from 'http-status';
import pick from '../utils/pick.js';
import ApiError from '../utils/ApiError.js';
import catchAsync from '../utils/catchAsync.js';
import * as styleCodeComboService from '../services/styleCodeCombo.service.js';

export const createStyleCodeCombo = catchAsync(async (req, res) => {
  const combo = await styleCodeComboService.createStyleCodeCombo(req.body);
  res.status(httpStatus.CREATED).send(combo);
});

export const getStyleCodeCombos = catchAsync(async (req, res) => {
  const filter = pick(req.query, ['comboCode', 'eanCode', 'status']);
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  const result = await styleCodeComboService.queryStyleCodeCombos(filter, options, req.query.search);
  res.send(result);
});

export const getStyleCodeCombo = catchAsync(async (req, res) => {
  const combo = await styleCodeComboService.getStyleCodeComboById(req.params.comboId);
  if (!combo) throw new ApiError(httpStatus.NOT_FOUND, 'Combo not found');
  res.send(combo);
});

export const updateStyleCodeCombo = catchAsync(async (req, res) => {
  const combo = await styleCodeComboService.updateStyleCodeComboById(req.params.comboId, req.body);
  res.send(combo);
});

export const deleteStyleCodeCombo = catchAsync(async (req, res) => {
  await styleCodeComboService.deleteStyleCodeComboById(req.params.comboId);
  res.status(httpStatus.NO_CONTENT).send();
});
