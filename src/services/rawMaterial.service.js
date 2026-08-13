import httpStatus from 'http-status';
import RawMaterial from '../models/rawMaterial.model.js';
import ApiError from '../utils/ApiError.js';

const normalizeSupplierBody = (body) => {
  if (!body || typeof body !== 'object') return body;
  const next = { ...body };
  if (next.supplier === '') next.supplier = null;
  if (next.sizeSpec && !next.countSize) next.countSize = next.sizeSpec;
  if (next.rate != null && next.rate !== '' && !next.mrp) {
    next.mrp = String(next.rate);
  }
  return next;
};

export const createRawMaterial = async (materialBody) => {
  return RawMaterial.create(normalizeSupplierBody(materialBody));
};

export const queryRawMaterials = async (filter, options, search) => {
  let queryFilter = { ...filter };
  if (search && typeof search === 'string' && search.trim()) {
    const escapedSearch = search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const searchRegex = new RegExp(escapedSearch, 'i');
    const searchFilter = {
      $or: [
        { name: searchRegex },
        { type: searchRegex },
        { sizeSpec: searchRegex },
        { description: searchRegex },
        { unit: searchRegex },
        { supplierName: searchRegex },
        { hsnCode: searchRegex },
        { gst: searchRegex },
        { groupName: searchRegex },
        { brand: searchRegex },
        { countSize: searchRegex },
        { material: searchRegex },
        { color: searchRegex },
        { shade: searchRegex },
        { mrp: searchRegex },
        { articleNo: searchRegex },
      ],
    };
    queryFilter = Object.keys(queryFilter).length
      ? { $and: [queryFilter, searchFilter] }
      : searchFilter;
  }

  const queryOptions = { ...options };
  if (!queryOptions.populate) {
    queryOptions.populate = 'supplier';
  }

  return RawMaterial.paginate(queryFilter, queryOptions);
};

export const getRawMaterialById = async (id) => {
  return RawMaterial.findById(id).populate('supplier');
};

export const updateRawMaterialById = async (materialId, updateBody) => {
  const material = await getRawMaterialById(materialId);
  if (!material) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Packaging material not found');
  }
  Object.assign(material, normalizeSupplierBody(updateBody));
  await material.save();
  return material.populate('supplier');
};

export const deleteRawMaterialById = async (materialId) => {
  const material = await RawMaterial.findById(materialId);
  if (!material) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Packaging material not found');
  }
  await material.deleteOne();
  return material;
};
