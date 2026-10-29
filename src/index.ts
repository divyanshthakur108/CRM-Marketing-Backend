import { createApp } from './app.js';
import { connectDB } from './config/db.js';
import { logger } from './config/logger.js';
import { env } from './config/env.js';
import { initAllIndexes } from './models/initIndexes.js';
import { rollingScheduler } from './scheduler/rollingScheduler.js';
import { startWorkerLoop, stopWorker } from './worker.js';
import mongoose from 'mongoose';

// Environment configurations loaded from .env
const PORT = env.PORT;

async function bootstrap() {
  const isConnected = await connectDB();

  if (isConnected) {
    await initAllIndexes();
    if (env.NODE_ENV !== 'test') {
      rollingScheduler.startDailyScheduler();
      startWorkerLoop().catch((err) => logger.error({ err }, 'Worker loop error'));
    }
  } else {
    logger.warn(
      'MongoDB is not connected. API server starting in degraded mode. ' +
      'Health check at /api/v1/health will report db: "disconnected".'
    );
    // When connection is subsequently established, initialize indexes
    mongoose.connection.once('connected', async () => {
      logger.info('MongoDB connection restored. Initializing database indexes...');
      try {
        await initAllIndexes();
        if (env.NODE_ENV !== 'test') {
          rollingScheduler.startDailyScheduler();
        }
      } catch (err: unknown) {
        logger.error({ err }, 'Error initializing indexes after connection restore');
      }
    });
  }

  const app = createApp();

  const server = app.listen(PORT, () => {
    logger.info(`Backend API server running in ${env.NODE_ENV} mode on http://localhost:${PORT}`);
    logger.info(`Health check available at http://localhost:${PORT}/api/v1/health`);
  });

  const handleShutdown = async (signal: string) => {
    logger.info(`Received ${signal}. Starting graceful shutdown...`);

    // Force close after 10 seconds if hanging
    const forceTimeout = setTimeout(() => {
      logger.error('Graceful shutdown timed out. Forcing process termination.');
      process.exit(1);
    }, 10000);

    // Stop rolling scheduler & worker loop
    rollingScheduler.stopDailyScheduler();
    stopWorker();

    server.close(async (err) => {
      if (err) {
        logger.error({ err }, 'Error closing HTTP server');
        process.exit(1);
      }

      logger.info('HTTP server closed successfully');

      try {
        await mongoose.disconnect();
        logger.info('MongoDB connection closed successfully');
      } catch (dbErr) {
        logger.error({ err: dbErr }, 'Error during MongoDB disconnect');
      } finally {
        clearTimeout(forceTimeout);
        logger.info('Graceful shutdown completed');
        process.exit(0);
      }
    });
  };

  process.on('SIGINT', () => handleShutdown('SIGINT'));
  process.on('SIGTERM', () => handleShutdown('SIGTERM'));
}

bootstrap().catch((error) => {
  logger.error({ err: error }, 'Fatal error during server bootstrap');
  process.exit(1);
});
