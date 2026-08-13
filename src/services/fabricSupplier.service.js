import httpStatus from 'http-status';
import FabricSupplier from '../models/fabricSupplier.model.js';
import ApiError from '../utils/ApiError.js';

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const createFabricSupplier = async (body) => {
  if (body.code) {
    const existing = await FabricSupplier.findOne({ code: body.code.trim().toUpperCase() });
    if (existing) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Supplier code already exists');
    }
  }
  return FabricSupplier.create(body);
};

export const queryFabricSuppliers = async (filter, options, search) => {
  let queryFilter = { ...filter };
  if (search && typeof search === 'string' && search.trim()) {
    const searchRegex = new RegExp(escapeRegex(search.trim()), 'i');
    const searchFilter = {
      $or: [
        { name: searchRegex },
        { code: searchRegex },
        { contactPerson: searchRegex },
        { contactNumber: searchRegex },
        { email: searchRegex },
        { address: searchRegex },
        { city: searchRegex },
        { gstin: searchRegex },
        { paymentTerms: searchRegex },
      ],
    };
    queryFilter = Object.keys(queryFilter).length
      ? { $and: [queryFilter, searchFilter] }
      : searchFilter;
  }
  return FabricSupplier.paginate(queryFilter, options);
};

export const getFabricSupplierById = async (id) => FabricSupplier.findById(id);

export const updateFabricSupplierById = async (supplierId, updateBody) => {
  const supplier = await getFabricSupplierById(supplierId);
  if (!supplier) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Fabric supplier not found');
  }
  if (updateBody.code) {
    const existing = await FabricSupplier.findOne({
      code: updateBody.code.trim().toUpperCase(),
      _id: { $ne: supplierId },
    });
    if (existing) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Supplier code already exists');
    }
  }
  Object.assign(supplier, updateBody);
  await supplier.save();
  return supplier;
};

export const deleteFabricSupplierById = async (supplierId) => {
  const supplier = await getFabricSupplierById(supplierId);
  if (!supplier) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Fabric supplier not found');
  }
  await supplier.deleteOne();
  return supplier;
};
