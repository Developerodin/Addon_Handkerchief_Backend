import mongoose from 'mongoose';
import httpStatus from 'http-status';
import ApiError from '../../utils/ApiError.js';
import HelpSupportHubFile from '../../models/helpSupport/hubFile.model.js';
import { deleteFileFromS3 } from '../../controllers/common.controller.js';

export const TASK_DOCUMENTS_FOLDER_NAME = 'Task Documents';
export const TASK_DOCUMENTS_SYSTEM_SLUG = 'task_documents';
export const TICKET_DOCUMENTS_FOLDER_NAME = 'Ticket Documents';
export const TICKET_DOCUMENTS_SYSTEM_SLUG = 'ticket_documents';

const isSystemFolder = (folderDoc) =>
  Boolean(
    folderDoc?.folder?.metadata?.isSystem ||
      folderDoc?.folder?.metadata?.systemSlug === TASK_DOCUMENTS_SYSTEM_SLUG ||
      folderDoc?.folder?.metadata?.systemSlug === TICKET_DOCUMENTS_SYSTEM_SLUG
  );

/**
 * Normalize a hub file/folder document for API responses.
 * @param {import('mongoose').Document|object|null} doc
 * @returns {object|null}
 */
const formatHubItem = (doc) => {
  if (!doc) return null;

  const type = doc.type ?? doc.get?.('type');
  const id = doc.id ?? doc._id?.toString();

  if (type === 'folder') {
    const folderSub =
      doc.folder?.name != null
        ? typeof doc.folder.toObject === 'function'
          ? doc.folder.toObject()
          : doc.folder
        : null;
    const raw = typeof doc.toJSON === 'function' ? doc.toJSON() : {};
    const folder = folderSub?.name ? folderSub : raw.folder;
    if (!folder || typeof folder !== 'object' || !folder.name) return null;
    return {
      id,
      type: 'folder',
      folder: {
        ...folder,
        parentFolder: folder.parentFolder?.toString?.() ?? folder.parentFolder ?? null,
        metadata: folder.metadata || {},
      },
      isDeleted: doc.isDeleted ?? raw.isDeleted ?? false,
    };
  }

  if (type === 'file') {
    const fileSub =
      doc.file?.fileName != null
        ? typeof doc.file.toObject === 'function'
          ? doc.file.toObject()
          : doc.file
        : null;
    const raw = typeof doc.toJSON === 'function' ? doc.toJSON() : {};
    const file = fileSub?.fileName ? fileSub : raw.file;
    if (!file || typeof file !== 'object' || !file.fileName) return null;
    return {
      id,
      type: 'file',
      file: {
        ...file,
        parentFolder: file.parentFolder?.toString?.() ?? file.parentFolder ?? null,
        metadata: file.metadata || {},
      },
      isDeleted: doc.isDeleted ?? raw.isDeleted ?? false,
    };
  }

  return null;
};

const formatHubList = (results = []) => (Array.isArray(results) ? results.map(formatHubItem).filter(Boolean) : []);

/**
 * Create a folder
 * @param {Object} folderBody
 * @returns {Promise<HelpSupportHubFile>}
 */
const createFolder = async (folderBody) => {
  const { name, parentFolder, createdBy, description, metadata } = folderBody;
  const normalizedParent = parentFolder || null;

  const isNameTaken = await HelpSupportHubFile.isFolderNameTaken(name, normalizedParent);
  if (isNameTaken) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Folder name already exists in this location');
  }

  // Build path
  let path = name;
  if (parentFolder) {
    const parent = await HelpSupportHubFile.findById(parentFolder);
    if (!parent || parent.type !== 'folder') {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Parent folder not found');
    }
    path = parent.folder.path + '/' + name;
  }

  const folder = await HelpSupportHubFile.create({
    type: 'folder',
    folder: {
      name,
      description,
      parentFolder: normalizedParent,
      createdBy,
      isRoot: !normalizedParent,
      path,
      metadata: metadata || {},
    },
  });

  return folder;
};

/**
 * Create a file
 * @param {Object} fileBody
 * @returns {Promise<HelpSupportHubFile>}
 */
const createFile = async (fileBody) => {
  const { fileName, fileUrl, fileKey, parentFolder, uploadedBy, fileSize, mimeType, metadata } = fileBody;

  if (!parentFolder) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Files must be uploaded inside a folder');
  }

  const parent = await HelpSupportHubFile.findById(parentFolder);
  if (!parent || parent.type !== 'folder' || parent.isDeleted) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Parent folder not found');
  }

  const isNameTaken = await HelpSupportHubFile.isFileNameTaken(fileName, parentFolder);
  if (isNameTaken) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'File name already exists in this folder');
  }

  const file = await HelpSupportHubFile.create({
    type: 'file',
    file: {
      fileName,
      fileUrl,
      fileKey,
      fileSize: fileSize || 0,
      mimeType,
      metadata: metadata || {},
      uploadedBy,
      parentFolder,
    },
  });

  return file;
};

/**
 * Find or create the protected Task Documents root folder.
 * @param {import('mongoose').Types.ObjectId} createdBy
 */
const ensureTaskDocumentsFolder = async (createdBy) => {
  let folder = await HelpSupportHubFile.findOne({
    type: 'folder',
    isDeleted: false,
    'folder.parentFolder': null,
    $or: [
      { 'folder.name': TASK_DOCUMENTS_FOLDER_NAME },
      { 'folder.metadata.systemSlug': TASK_DOCUMENTS_SYSTEM_SLUG },
    ],
  });

  if (folder) {
    if (!folder.folder.metadata?.isSystem) {
      folder.folder.metadata = {
        ...(folder.folder.metadata || {}),
        isSystem: true,
        systemSlug: TASK_DOCUMENTS_SYSTEM_SLUG,
      };
      await folder.save();
    }
    return folder;
  }

  folder = await HelpSupportHubFile.create({
    type: 'folder',
    folder: {
      name: TASK_DOCUMENTS_FOLDER_NAME,
      description: 'System folder for task attachments. Cannot be deleted.',
      parentFolder: null,
      createdBy,
      isRoot: true,
      path: TASK_DOCUMENTS_FOLDER_NAME,
      metadata: { isSystem: true, systemSlug: TASK_DOCUMENTS_SYSTEM_SLUG },
    },
  });

  return folder;
};

/**
 * Find or create the protected Ticket Documents root folder.
 * @param {import('mongoose').Types.ObjectId} createdBy
 */
const ensureTicketDocumentsFolder = async (createdBy) => {
  let folder = await HelpSupportHubFile.findOne({
    type: 'folder',
    isDeleted: false,
    'folder.parentFolder': null,
    $or: [
      { 'folder.name': TICKET_DOCUMENTS_FOLDER_NAME },
      { 'folder.metadata.systemSlug': TICKET_DOCUMENTS_SYSTEM_SLUG },
    ],
  });

  if (folder) {
    if (!folder.folder.metadata?.isSystem) {
      folder.folder.metadata = {
        ...(folder.folder.metadata || {}),
        isSystem: true,
        systemSlug: TICKET_DOCUMENTS_SYSTEM_SLUG,
      };
      await folder.save();
    }
    return folder;
  }

  folder = await HelpSupportHubFile.create({
    type: 'folder',
    folder: {
      name: TICKET_DOCUMENTS_FOLDER_NAME,
      description: 'System folder for ticket attachments. Cannot be deleted.',
      parentFolder: null,
      createdBy,
      isRoot: true,
      path: TICKET_DOCUMENTS_FOLDER_NAME,
      metadata: { isSystem: true, systemSlug: TICKET_DOCUMENTS_SYSTEM_SLUG },
    },
  });

  return folder;
};

/**
 * Get folder by id
 * @param {ObjectId} id
 * @returns {Promise<HelpSupportHubFile>}
 */
const getFolderById = async (id) => {
  const folder = await HelpSupportHubFile.findOne({
    _id: id,
    type: 'folder',
    isDeleted: false,
  }).populate('folder.createdBy', 'name email');
  
  if (!folder) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Folder not found');
  }
  
  return folder;
};

/**
 * Get file by id
 * @param {ObjectId} id
 * @returns {Promise<HelpSupportHubFile>}
 */
const getFileById = async (id) => {
  const file = await HelpSupportHubFile.findOne({
    _id: id,
    type: 'file',
    isDeleted: false,
  }).populate('file.uploadedBy', 'name email');
  
  if (!file) {
    throw new ApiError(httpStatus.NOT_FOUND, 'File not found');
  }
  
  return file;
};

/**
 * Get folder contents (subfolders and files)
 * @param {ObjectId} folderId
 * @param {Object} options
 * @returns {Promise<Object>}
 */
const getFolderContents = async (folderId, options = {}) => {
  const folder = await getFolderById(folderId);

  const filter = {
    $or: [{ 'folder.parentFolder': folderId }, { 'file.parentFolder': folderId }],
    isDeleted: false,
  };

  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 50;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;

  const countPromise = HelpSupportHubFile.countDocuments(filter);
  const docsPromise = HelpSupportHubFile.find(filter)
    .populate('folder.createdBy', 'name email role')
    .populate('file.uploadedBy', 'name email role')
    .sort(options.sortBy || 'type:asc,folder.name:asc,file.fileName:asc')
    .skip(skip)
    .limit(limit);

  const [totalResults, results] = await Promise.all([countPromise, docsPromise]);
  const totalPages = Math.ceil(totalResults / limit) || 1;

  return {
    folder: formatHubItem(folder),
    contents: {
      results: formatHubList(results),
      page,
      limit,
      totalPages,
      totalResults,
    },
  };
};

/**
 * Get root folders for a user
 * @param {ObjectId} userId
 * @param {Object} options
 * @returns {Promise<Object>}
 */
const getRootFolders = async (_userId, options = {}) => {
  const filter = {
    isDeleted: false,
    $or: [
      { type: 'folder', 'folder.parentFolder': null },
      { type: 'file', 'file.parentFolder': null },
    ],
  };

  const limit = options.limit && parseInt(options.limit, 10) > 0 ? parseInt(options.limit, 10) : 100;
  const page = options.page && parseInt(options.page, 10) > 0 ? parseInt(options.page, 10) : 1;
  const skip = (page - 1) * limit;

  const countPromise = HelpSupportHubFile.countDocuments(filter);
  const docsPromise = HelpSupportHubFile.find(filter)
    .populate('folder.createdBy', 'name email role')
    .populate('file.uploadedBy', 'name email role')
    .sort({ type: 1, 'folder.name': 1, 'file.fileName': 1 })
    .skip(skip)
    .limit(limit);

  const [totalResults, results] = await Promise.all([countPromise, docsPromise]);
  const totalPages = Math.ceil(totalResults / limit) || 1;

  return {
    results: formatHubList(results),
    page,
    limit,
    totalPages,
    totalResults,
  };
};

/**
 * Update folder
 * @param {ObjectId} folderId
 * @param {Object} updateBody
 * @returns {Promise<HelpSupportHubFile>}
 */
const updateFolder = async (folderId, updateBody) => {
  const folder = await getFolderById(folderId);
  
  const { name, description, metadata } = updateBody;
  
  // Check if new name conflicts with existing folder
  if (name && name !== folder.folder.name) {
    const isNameTaken = await HelpSupportHubFile.isFolderNameTaken(name, folder.folder.parentFolder, folderId);
    if (isNameTaken) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Folder name already exists in this location');
    }
  }

  // Update folder
  Object.assign(folder.folder, {
    name: name || folder.folder.name,
    description: description !== undefined ? description : folder.folder.description,
    metadata: metadata || folder.folder.metadata,
  });

  await folder.save();
  return folder;
};

/**
 * Update file
 * @param {ObjectId} fileId
 * @param {Object} updateBody
 * @returns {Promise<HelpSupportHubFile>}
 */
const updateFile = async (fileId, updateBody) => {
  const file = await getFileById(fileId);
  
  const { fileName, fileUrl, fileKey, fileSize, mimeType, metadata } = updateBody;
  
  // Check if new name conflicts with existing file
  if (fileName && fileName !== file.file.fileName) {
    const isNameTaken = await HelpSupportHubFile.isFileNameTaken(fileName, file.file.parentFolder, fileId);
    if (isNameTaken) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'File name already exists in this folder');
    }
  }

  // Update file
  Object.assign(file.file, {
    fileName: fileName || file.file.fileName,
    fileUrl: fileUrl || file.file.fileUrl,
    fileKey: fileKey || file.file.fileKey,
    fileSize: fileSize !== undefined ? fileSize : file.file.fileSize,
    mimeType: mimeType || file.file.mimeType,
    metadata: metadata || file.file.metadata,
  });

  await file.save();
  return file;
};

/**
 * Delete folder and all its contents recursively
 * @param {ObjectId} folderId
 * @returns {Promise<Object>}
 */
const deleteFolder = async (folderId) => {
  const folder = await getFolderById(folderId);

  if (isSystemFolder(folder)) {
    throw new ApiError(httpStatus.FORBIDDEN, 'This system folder cannot be deleted');
  }
  
  // Get all descendants
  const descendants = await folder.getAllDescendants();
  
  // Soft delete all descendants
  const descendantIds = descendants.map(item => item._id);
  descendantIds.push(folderId);
  
  await HelpSupportHubFile.updateMany(
    { _id: { $in: descendantIds } },
    { isDeleted: true }
  );

  return {
    deletedFolder: folder,
    deletedItems: descendants.length + 1,
  };
};

/**
 * Delete file
 * @param {ObjectId} fileId
 * @returns {Promise<HelpSupportHubFile>}
 */
const deleteFile = async (fileId) => {
  const file = await getFileById(fileId);
  const fileKey = file.file?.fileKey;
  file.isDeleted = true;
  await file.save();
  if (fileKey) {
    try {
      await deleteFileFromS3(fileKey);
      console.debug(`S3 file deleted: ${fileKey}`);
    } catch (err) {
      console.error(`Failed to delete S3 file: ${fileKey}`, err);
    }
  }
  return file;
};

/**
 * Delete multiple items
 * @param {Array<ObjectId>} itemIds
 * @returns {Promise<Object>}
 */
const deleteMultipleItems = async (itemIds) => {
  const items = await HelpSupportHubFile.find({
    _id: { $in: itemIds },
    isDeleted: false,
  });

  if (items.length === 0) {
    throw new ApiError(httpStatus.NOT_FOUND, 'No items found to delete');
  }

  const foldersToDelete = [];
  const filesToDelete = [];

  // Separate folders and files
  for (const item of items) {
    if (item.type === 'folder') {
      foldersToDelete.push(item);
    } else {
      filesToDelete.push(item);
    }
  }

  // Delete folders recursively
  const deletedFolders = [];
  for (const folder of foldersToDelete) {
    const result = await deleteFolder(folder._id);
    deletedFolders.push(result);
  }

  // Delete files
  const deletedFiles = [];
  for (const file of filesToDelete) {
    const result = await deleteFile(file._id);
    deletedFiles.push(result);
  }

  return {
    deletedFolders,
    deletedFiles,
    totalDeleted: items.length,
  };
};

/**
 * Search files and folders
 * @param {Object} filter
 * @param {Object} options
 * @returns {Promise<Object>}
 */
const searchItems = async (filter, options = {}) => {
  const escaped = String(filter.query || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const searchFilter = {
    isDeleted: false,
    $or: [
      { 'folder.name': { $regex: escaped, $options: 'i' } },
      { 'file.fileName': { $regex: escaped, $options: 'i' } },
    ],
  };

  if (filter.type) {
    searchFilter.type = filter.type;
  }

  const result = await HelpSupportHubFile.paginate(searchFilter, {
    ...options,
    populate: 'folder.createdBy,file.uploadedBy',
    sortBy: options.sortBy || 'type:asc,folder.name:asc,file.fileName:asc',
  });

  return {
    ...result,
    results: formatHubList(result.results),
  };
};

/**
 * Get folder tree structure
 * @param {ObjectId} userId
 * @param {ObjectId} rootFolderId
 * @returns {Promise<Object>}
 */
const getFolderTree = async (_userId, rootFolderId = null) => {
  const buildTree = async (parentId) => {
    const children = await HelpSupportHubFile.find({
      type: 'folder',
      'folder.parentFolder': parentId,
      isDeleted: false,
    }).populate('folder.createdBy', 'name email role');

    const tree = [];
    for (const child of children) {
      const node = {
        id: child._id,
        name: child.folder.name,
        path: child.folder.path,
        description: child.folder.description,
        createdBy: child.folder.createdBy,
        createdAt: child.createdAt,
        updatedAt: child.updatedAt,
        children: await buildTree(child._id),
      };
      tree.push(node);
    }

    return tree;
  };

  const tree = await buildTree(rootFolderId);
  return tree;
};

export {
  formatHubItem,
  createFolder,
  createFile,
  getFolderById,
  getFileById,
  getFolderContents,
  getRootFolders,
  updateFolder,
  updateFile,
  deleteFolder,
  deleteFile,
  deleteMultipleItems,
  searchItems,
  getFolderTree,
  ensureTaskDocumentsFolder,
  ensureTicketDocumentsFolder,
}; 