import multer from 'multer';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import AWS from 'aws-sdk';
import config from '../config/config.js';
import catchAsync from '../utils/catchAsync.js';
import httpStatus from 'http-status';
import ApiError from '../utils/ApiError.js';

const isS3Configured = () =>
  Boolean(
    config.aws.accessKeyId &&
      config.aws.secretAccessKey &&
      config.aws.region &&
      config.aws.s3.bucket
  );

const getS3Client = () => {
  if (!isS3Configured()) {
    throw new ApiError(
      httpStatus.SERVICE_UNAVAILABLE,
      'S3 upload is not configured. Set AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION, and AWS_BUCKET_NAME in .env'
    );
  }

  return new AWS.S3({
    accessKeyId: config.aws.accessKeyId,
    secretAccessKey: config.aws.secretAccessKey,
    region: config.aws.region,
    signatureVersion: 'v4',
  });
};

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
  fileFilter: (_req, _file, cb) => {
    cb(null, true);
  },
});

/**
 * Upload a file buffer to S3.
 * @param {Object} file - Multer file object
 * @returns {Promise<{url: string, key: string}>}
 */
const uploadFileToS3 = async (file) => {
  if (!file) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'No file provided');
  }

  const s3 = getS3Client();
  const uniqueFileName = `${Date.now()}-${uuidv4()}${path.extname(file.originalname)}`;

  const uploadResult = await s3
    .upload({
      Bucket: config.aws.s3.bucket,
      Key: uniqueFileName,
      Body: file.buffer,
      ContentType: file.mimetype,
    })
    .promise();

  return {
    url: uploadResult.Location,
    key: uploadResult.Key,
  };
};

/**
 * Delete a file from S3 by key.
 * @param {string} key
 */
const deleteFileFromS3 = async (key) => {
  if (!key) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'File key is required');
  }

  const s3 = getS3Client();
  await s3
    .deleteObject({
      Bucket: config.aws.s3.bucket,
      Key: key,
    })
    .promise();
};

const uploadFile = catchAsync(async (req, res) => {
  if (!req.file) {
    return res.status(httpStatus.BAD_REQUEST).json({
      success: false,
      message: 'No file uploaded',
    });
  }

  const { url, key } = await uploadFileToS3(req.file);

  res.status(httpStatus.OK).json({
    success: true,
    message: 'File uploaded successfully',
    data: {
      url,
      key,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      size: req.file.size,
    },
  });
});

const deleteFile = catchAsync(async (req, res) => {
  const { key } = req.params;
  await deleteFileFromS3(key);

  res.status(httpStatus.OK).json({
    success: true,
    message: 'File deleted successfully',
  });
});

export { upload, uploadFile, deleteFile, uploadFileToS3, deleteFileFromS3 };
