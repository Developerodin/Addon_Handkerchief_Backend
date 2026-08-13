import httpStatus from 'http-status';
import FabricCatalog from '../models/fabricCatalog.model.js';
import ApiError from '../utils/ApiError.js';

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const normalizeBody = (body) => {
  if (!body) return body;
  const next = { ...body };
  if (next.supplier === '') next.supplier = null;
  return next;
};

export const createFabricCatalog = async (body) => {
  const payload = normalizeBody(body);
  if (payload.code) {
    const existing = await FabricCatalog.findOne({ code: String(payload.code).trim().toUpperCase() });
    if (existing) throw new ApiError(httpStatus.BAD_REQUEST, 'Fabric code already exists');
  }
  return FabricCatalog.create(payload);
};

export const queryFabricCatalogs = async (filter, options, search) => {
  let queryFilter = { ...filter };
  if (search && typeof search === 'string' && search.trim()) {
    const searchRegex = new RegExp(escapeRegex(search.trim()), 'i');
    const searchFilter = {
      $or: [
        { name: searchRegex },
        { code: searchRegex },
        { fabricType: searchRegex },
        { composition: searchRegex },
        { colour: searchRegex },
        { shade: searchRegex },
        { pantone: searchRegex },
        { design: searchRegex },
        { hsnCode: searchRegex },
        { supplierName: searchRegex },
      ],
    };
    queryFilter = Object.keys(queryFilter).length ? { $and: [queryFilter, searchFilter] } : searchFilter;
  }
  const queryOptions = { ...options };
  if (!queryOptions.populate) queryOptions.populate = 'supplier';
  return FabricCatalog.paginate(queryFilter, queryOptions);
};

export const getFabricCatalogById = async (id) => FabricCatalog.findById(id).populate('supplier');

export const updateFabricCatalogById = async (fabricId, updateBody) => {
  const fabric = await getFabricCatalogById(fabricId);
  if (!fabric) throw new ApiError(httpStatus.NOT_FOUND, 'Fabric not found');
  const payload = normalizeBody(updateBody);
  if (payload.code) {
    const existing = await FabricCatalog.findOne({
      code: String(payload.code).trim().toUpperCase(),
      _id: { $ne: fabricId },
    });
    if (existing) throw new ApiError(httpStatus.BAD_REQUEST, 'Fabric code already exists');
  }
  Object.assign(fabric, payload);
  await fabric.save();
  return fabric.populate('supplier');
};

export const deleteFabricCatalogById = async (fabricId) => {
  const fabric = await FabricCatalog.findById(fabricId);
  if (!fabric) throw new ApiError(httpStatus.NOT_FOUND, 'Fabric not found');
  await fabric.deleteOne();
  return fabric;
};
