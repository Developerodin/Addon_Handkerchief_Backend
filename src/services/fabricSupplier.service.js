import httpStatus from 'http-status';
import FabricSupplier from '../models/fabricSupplier.model.js';
import FabricCatalog from '../models/fabricCatalog.model.js';
import ApiError from '../utils/ApiError.js';

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const SUPPLIER_POPULATE = {
  path: 'fabricDetails.fabricCatalogId',
  select: 'name fabricSortNo fabricTypeName colourName status',
};

const resolveFabricDetails = async (fabricDetails) => {
  if (!Array.isArray(fabricDetails)) {
    return [];
  }

  const seen = new Set();
  const resolved = [];

  for (const detail of fabricDetails) {
    const fabricCatalogId = String(detail?.fabricCatalogId || '').trim();
    if (!fabricCatalogId) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Fabric catalog id is required for each fabric detail');
    }
    if (seen.has(fabricCatalogId)) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Duplicate fabric selected in fabric details');
    }
    seen.add(fabricCatalogId);

    const fabric = await FabricCatalog.findById(fabricCatalogId);
    if (!fabric) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Fabric catalog entry not found');
    }

    resolved.push({
      fabricCatalogId,
      fabricName: fabric.name || '',
      fabricSortNo: fabric.fabricSortNo || '',
      fabricTypeName: fabric.fabricTypeName || '',
      colourName: fabric.colourName || '',
    });
  }

  return resolved;
};

const normalizeBody = async (body) => {
  if (!body) return body;
  const next = { ...body };
  if (Object.prototype.hasOwnProperty.call(next, 'fabricDetails')) {
    next.fabricDetails = await resolveFabricDetails(next.fabricDetails);
  }
  if (next.fabricMill != null) {
    next.fabricMill = String(next.fabricMill).trim();
  }
  return next;
};

export const createFabricSupplier = async (body) => {
  const payload = await normalizeBody(body);
  const supplier = await FabricSupplier.create(payload);
  return supplier.populate(SUPPLIER_POPULATE);
};

export const queryFabricSuppliers = async (filter, options, search) => {
  let queryFilter = { ...filter };
  if (search && typeof search === 'string' && search.trim()) {
    const searchRegex = new RegExp(escapeRegex(search.trim()), 'i');
    const searchFilter = {
      $or: [
        { name: searchRegex },
        { contactPerson: searchRegex },
        { contactNumber: searchRegex },
        { email: searchRegex },
        { address: searchRegex },
        { city: searchRegex },
        { gstin: searchRegex },
        { paymentTerms: searchRegex },
        { fabricMill: searchRegex },
        { 'fabricDetails.fabricName': searchRegex },
        { 'fabricDetails.fabricSortNo': searchRegex },
      ],
    };
    queryFilter = Object.keys(queryFilter).length
      ? { $and: [queryFilter, searchFilter] }
      : searchFilter;
  }
  const queryOptions = { ...options };
  if (!queryOptions.populate) {
    queryOptions.populate = [SUPPLIER_POPULATE];
  }
  return FabricSupplier.paginate(queryFilter, queryOptions);
};

export const getFabricSupplierById = async (id) =>
  FabricSupplier.findById(id).populate(SUPPLIER_POPULATE);

export const updateFabricSupplierById = async (supplierId, updateBody) => {
  const supplier = await FabricSupplier.findById(supplierId);
  if (!supplier) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Fabric supplier not found');
  }
  const payload = await normalizeBody(updateBody);
  Object.assign(supplier, payload);
  await supplier.save();
  return supplier.populate(SUPPLIER_POPULATE);
};

export const deleteFabricSupplierById = async (supplierId) => {
  const supplier = await getFabricSupplierById(supplierId);
  if (!supplier) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Fabric supplier not found');
  }
  await supplier.deleteOne();
  return supplier;
};
