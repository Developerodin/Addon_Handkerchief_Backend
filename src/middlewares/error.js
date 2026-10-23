import mongoose from 'mongoose';
import httpStatus from 'http-status';
import config from '../config/config.js';
import logger from '../config/logger.js';
import ApiError from '../utils/ApiError.js';


const errorConverter = (err, req, res, next) => {
  let error = err;
  if (!(error instanceof ApiError)) {
    // Duplicate key → 400 so clients see a clear message instead of a masked 500.
    if (err?.code === 11000) {
      const field = Object.keys(err.keyPattern || err.keyValue || {})[0] || 'field';
      error = new ApiError(httpStatus.BAD_REQUEST, `Duplicate value for ${field}`, true, err.stack);
    } else {
      const statusCode =
        error.statusCode || error instanceof mongoose.Error ? httpStatus.BAD_REQUEST : httpStatus.INTERNAL_SERVER_ERROR;
      const message = error.message || httpStatus[statusCode];
      // Keep converted mongoose/driver errors operational so production does not hide the real message.
      const isOperational = error instanceof mongoose.Error || err?.name === 'MongoError' || err?.name === 'MongoServerError';
      error = new ApiError(statusCode, message, isOperational, err.stack);
    }
  }
  next(error);
};

// eslint-disable-next-line no-unused-vars
const errorHandler = (err, req, res, next) => {
  let { statusCode, message } = err;
  if (config.env === 'production' && !err.isOperational) {
    statusCode = httpStatus.INTERNAL_SERVER_ERROR;
    message = httpStatus[httpStatus.INTERNAL_SERVER_ERROR];
  }

  res.locals.errorMessage = err.message;

  const response = {
    code: statusCode,
    message,
    ...(config.env === 'development' && { stack: err.stack }),
  };

  // Always log server failures; production previously hid the root cause from both client and logs.
  logger.error(err);

  res.status(statusCode).send(response);
};

export {
  errorConverter,
  errorHandler,
};

