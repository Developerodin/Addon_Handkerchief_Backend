import express from 'express';
import multer from 'multer';
import auth from '../../../middlewares/auth.js';
import validate from '../../../middlewares/validate.js';
import { requireCrud } from '../../../middlewares/requireCrud.js';
import * as hubFileValidation from '../../../validations/helpSupport/hubFile.validation.js';
import * as hubFileController from '../../../controllers/helpSupport/hubFile.controller.js';
import { hubUpload, hubUploadFile } from '../../../controllers/helpSupport/hubUpload.controller.js';

const router = express.Router();
const HS_FILES = 'Help & Support.Files';

router.post(
  '/upload',
  auth('getHelpSupportHub'),
  requireCrud(HS_FILES, 'create'),
  (req, res, next) => {
    hubUpload.single('file')(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(413).json({ success: false, message: 'File too large. Maximum size is 25MB' });
        }
        return res.status(400).json({ success: false, message: err.message });
      }
      if (err) return next(err);
      return next();
    });
  },
  hubUploadFile
);

router.get(
  '/root-folders',
  auth('getHelpSupportHub'),
  requireCrud(HS_FILES, 'read'),
  validate(hubFileValidation.getRootFolders),
  hubFileController.getRootFolders
);
router.get(
  '/task-documents-folder',
  auth('getHelpSupportHub'),
  requireCrud(HS_FILES, 'read'),
  hubFileController.getTaskDocumentsFolder
);
router.get(
  '/ticket-documents-folder',
  auth('getHelpSupportHub'),
  requireCrud(HS_FILES, 'read'),
  hubFileController.getTicketDocumentsFolder
);
router.get(
  '/folder-tree',
  auth('getHelpSupportHub'),
  requireCrud(HS_FILES, 'read'),
  validate(hubFileValidation.getFolderTree),
  hubFileController.getFolderTree
);
router.get(
  '/search',
  auth('getHelpSupportHub'),
  requireCrud(HS_FILES, 'read'),
  validate(hubFileValidation.searchItems),
  hubFileController.searchItems
);

router.post(
  '/folders',
  auth('getHelpSupportHub'),
  requireCrud(HS_FILES, 'create'),
  validate(hubFileValidation.createFolder),
  hubFileController.createFolder
);
router
  .route('/folders/:folderId')
  .get(
    auth('getHelpSupportHub'),
    requireCrud(HS_FILES, 'read'),
    validate(hubFileValidation.getFolder),
    hubFileController.getFolder
  )
  .patch(
    auth('getHelpSupportHub'),
    requireCrud(HS_FILES, 'update'),
    validate(hubFileValidation.updateFolder),
    hubFileController.updateFolder
  )
  .delete(
    auth('getHelpSupportHub'),
    requireCrud(HS_FILES, 'delete'),
    validate(hubFileValidation.deleteFolder),
    hubFileController.deleteFolder
  );

router.get(
  '/folders/:folderId/contents',
  auth('getHelpSupportHub'),
  requireCrud(HS_FILES, 'read'),
  validate(hubFileValidation.getFolderContents),
  hubFileController.getFolderContents
);

router.post(
  '/files',
  auth('getHelpSupportHub'),
  requireCrud(HS_FILES, 'create'),
  validate(hubFileValidation.createFile),
  hubFileController.createFile
);
router
  .route('/files/:fileId')
  .get(
    auth('getHelpSupportHub'),
    requireCrud(HS_FILES, 'read'),
    validate(hubFileValidation.getFile),
    hubFileController.getFile
  )
  .patch(
    auth('getHelpSupportHub'),
    requireCrud(HS_FILES, 'update'),
    validate(hubFileValidation.updateFile),
    hubFileController.updateFile
  )
  .delete(
    auth('getHelpSupportHub'),
    requireCrud(HS_FILES, 'delete'),
    validate(hubFileValidation.deleteFile),
    hubFileController.deleteFile
  );

router.delete(
  '/items',
  auth('getHelpSupportHub'),
  requireCrud(HS_FILES, 'delete'),
  validate(hubFileValidation.deleteMultipleItems),
  hubFileController.deleteMultipleItems
);

export default router;
