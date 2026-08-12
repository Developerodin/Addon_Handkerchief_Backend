import multer from 'multer';
import catchAsync from '../../utils/catchAsync.js';
import httpStatus from 'http-status';
import { uploadFileToS3 } from '../common.controller.js';
import { decodeUploadedFileName } from '../../utils/fileName.util.js';

const storage = multer.memoryStorage();

export const hubUpload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, _file, cb) => cb(null, true),
});

export const hubUploadFile = catchAsync(async (req, res) => {
  if (!req.file) {
    return res.status(httpStatus.BAD_REQUEST).json({
      success: false,
      message: 'No file uploaded',
    });
  }

  const { url, key } = await uploadFileToS3(req.file);
  const originalName = decodeUploadedFileName(req.body?.originalFileName, req.file.originalname);

  res.status(httpStatus.OK).json({
    success: true,
    message: 'File uploaded successfully',
    data: {
      url,
      key,
      originalName,
      mimeType: req.file.mimetype,
      size: req.file.size,
    },
  });
});
