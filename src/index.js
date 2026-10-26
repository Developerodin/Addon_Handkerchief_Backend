import mongoose from 'mongoose';
import app from './app.js';
import config from './config/config.js';
import logger from './config/logger.js';
import { renameFabricGlmFieldsToGsm } from './utils/renameFabricGlmToGsm.js';

const { emitWarning } = process;
process.emitWarning = (warning, ...args) => {
  if (args[0] === 'DeprecationWarning' && args[1] === 'DEP0170') return;
  if (typeof warning === 'object' && warning?.code === 'DEP0170') return;
  return emitWarning.call(process, warning, ...args);
};

let server;
mongoose.connect(config.mongoose.url, config.mongoose.options).then(async () => {
  logger.info('Connected to MongoDB');
  try {
    const renamed = await renameFabricGlmFieldsToGsm();
    if (renamed.modifiedCount > 0) {
      logger.info(`Renamed GLM fields to GSM on ${renamed.modifiedCount} fabric catalog(s)`);
    }
  } catch (error) {
    logger.error(error);
    throw error;
  }
  server = app.listen(config.port, () => {
    logger.info(`Listening to port ${config.port}`);
  });
});

const exitHandler = () => {
  if (server) {
    server.close(() => {
      logger.info('Server closed');
      process.exit(1);
    });
  } else {
    process.exit(1);
  }
};

const unexpectedErrorHandler = (error) => {
  logger.error(error);
  exitHandler();
};

process.on('uncaughtException', unexpectedErrorHandler);
process.on('unhandledRejection', unexpectedErrorHandler);

process.on('SIGTERM', () => {
  logger.info('SIGTERM received');
  if (server) {
    server.close();
  }
});
