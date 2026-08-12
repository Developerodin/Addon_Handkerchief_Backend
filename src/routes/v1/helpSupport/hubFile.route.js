import express from 'express';
import multer from 'multer';
import auth from '../../../middlewares/auth.js';
import validate from '../../../middlewares/validate.js';
import * as hubFileValidation from '../../../validations/helpSupport/hubFile.validation.js';
import * as hubFileController from '../../../controllers/helpSupport/hubFile.controller.js';
import { hubUpload, hubUploadFile } from '../../../controllers/helpSupport/hubUpload.controller.js';

const router = express.Router();

router.use(auth('getHelpSupportHub'));

router.post('/upload', (req, res, next) => {
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
}, hubUploadFile);

router.get('/root-folders', validate(hubFileValidation.getRootFolders), hubFileController.getRootFolders);
router.get('/folder-tree', validate(hubFileValidation.getFolderTree), hubFileController.getFolderTree);
router.get('/search', validate(hubFileValidation.searchItems), hubFileController.searchItems);

router.post('/folders', validate(hubFileValidation.createFolder), hubFileController.createFolder);
router
  .route('/folders/:folderId')
  .get(validate(hubFileValidation.getFolder), hubFileController.getFolder)
  .patch(validate(hubFileValidation.updateFolder), hubFileController.updateFolder)
  .delete(validate(hubFileValidation.deleteFolder), hubFileController.deleteFolder);

router.get(
  '/folders/:folderId/contents',
  validate(hubFileValidation.getFolderContents),
  hubFileController.getFolderContents
);

router.post('/files', validate(hubFileValidation.createFile), hubFileController.createFile);
router
  .route('/files/:fileId')
  .get(validate(hubFileValidation.getFile), hubFileController.getFile)
  .patch(validate(hubFileValidation.updateFile), hubFileController.updateFile)
  .delete(validate(hubFileValidation.deleteFile), hubFileController.deleteFile);

router.delete('/items', validate(hubFileValidation.deleteMultipleItems), hubFileController.deleteMultipleItems);

export default router;
