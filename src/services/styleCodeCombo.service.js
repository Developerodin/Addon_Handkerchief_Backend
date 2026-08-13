import httpStatus from 'http-status';
import StyleCodeCombo from '../models/styleCodeCombo.model.js';
import ApiError from '../utils/ApiError.js';

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const createStyleCodeCombo = async (body) => {
  const existing = await StyleCodeCombo.findOne({ comboCode: body.comboCode.trim() });
  if (existing) throw new ApiError(httpStatus.BAD_REQUEST, 'Combo code already exists');
  return StyleCodeCombo.create(body);
};

export const queryStyleCodeCombos = async (filter, options, search) => {
  let queryFilter = { ...filter };
  if (search && typeof search === 'string' && search.trim()) {
    const searchRegex = new RegExp(escapeRegex(search.trim()), 'i');
    const searchFilter = {
      $or: [{ comboCode: searchRegex }, { eanCode: searchRegex }, { brand: searchRegex }, { pack: searchRegex }],
    };
    queryFilter = Object.keys(queryFilter).length ? { $and: [queryFilter, searchFilter] } : searchFilter;
  }
  const queryOptions = { ...options };
  if (!queryOptions.populate) queryOptions.populate = 'components.styleCode';
  return StyleCodeCombo.paginate(queryFilter, queryOptions);
};

export const getStyleCodeComboById = async (id) =>
  StyleCodeCombo.findById(id).populate('components.styleCode');

export const updateStyleCodeComboById = async (comboId, updateBody) => {
  const combo = await getStyleCodeComboById(comboId);
  if (!combo) throw new ApiError(httpStatus.NOT_FOUND, 'Combo not found');
  if (updateBody.comboCode) {
    const existing = await StyleCodeCombo.findOne({
      comboCode: updateBody.comboCode.trim(),
      _id: { $ne: comboId },
    });
    if (existing) throw new ApiError(httpStatus.BAD_REQUEST, 'Combo code already exists');
  }
  Object.assign(combo, updateBody);
  await combo.save();
  return combo.populate('components.styleCode');
};

export const deleteStyleCodeComboById = async (comboId) => {
  const combo = await StyleCodeCombo.findById(comboId);
  if (!combo) throw new ApiError(httpStatus.NOT_FOUND, 'Combo not found');
  await combo.deleteOne();
  return combo;
};
