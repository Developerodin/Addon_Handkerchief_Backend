import express from 'express';
import multer from 'multer';
import httpStatus from 'http-status';
import { upload, uploadFile, deleteFile } from '../../controllers/common.controller.js';

const router = express.Router();

const handleMulterError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(httpStatus.REQUEST_ENTITY_TOO_LARGE).json({
        success: false,
        message: 'File too large. Maximum size is 5MB',
      });
    }
    return res.status(httpStatus.BAD_REQUEST).json({
      success: false,
      message: err.message,
    });
  }
  return next(err);
};

const uploadSingleFile = (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      return handleMulterError(err, req, res, next);
    }
    return next();
  });
};

/**
 * POST /v1/common/upload - Upload a file to S3
 */
router.post('/upload', uploadSingleFile, uploadFile);

/**
 * DELETE /v1/common/files/:key - Delete a file from S3
 */
router.delete('/files/:key', deleteFile);

export default router;
