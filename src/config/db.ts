import mongoose from 'mongoose';
import { env } from './env.js';
import { logger } from './logger.js';

export const getDbStatus = (): 'connected' | 'disconnected' => {
  // readyState: 0 = disconnected, 1 = connected, 2 = connecting, 3 = disconnecting
  return mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
};

export const sanitizeMongoUri = (uri: string): string => {
  return uri.replace(/\/\/([^:]+):([^@]+)@/, '//***:***@');
};

let listenersInitialized = false;
let reconnectTimeout: NodeJS.Timeout | null = null;

const scheduleReconnect = (delayMs = 5000) => {
  if (reconnectTimeout) return;
  reconnectTimeout = setTimeout(async () => {
    reconnectTimeout = null;
    if (mongoose.connection.readyState === 0) {
      logger.info('Attempting to reconnect to MongoDB Atlas in background...');
      await connectDB();
    }
  }, delayMs);
};

const setupConnectionListeners = () => {
  if (listenersInitialized) return;
  listenersInitialized = true;

  mongoose.connection.on('connected', () => {
    logger.info('MongoDB connection established successfully');
  });

  mongoose.connection.on('error', (err) => {
    logger.error({ err }, 'MongoDB runtime error');
  });

  mongoose.connection.on('disconnected', () => {
    logger.warn('MongoDB connection disconnected. Scheduling background reconnect...');
    scheduleReconnect();
  });
};

export const connectDB = async (): Promise<boolean> => {
  setupConnectionListeners();
  const uri = env.MONGODB_URI;

  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });
    logger.info(
      { uri: sanitizeMongoUri(uri) },
      'Connected to MongoDB'
    );
    return true;
  } catch (error: unknown) {
    const isServerSelection =
      error instanceof Error &&
      (error.name === 'MongooseServerSelectionError' ||
        error.message.includes('ReplicaSetNoPrimary') ||
        error.message.includes('Could not connect to any servers'));

    if (isServerSelection) {
      logger.error(
        {
          uri: sanitizeMongoUri(uri),
          reason: 'Atlas IP Whitelist / Network Connectivity',
        },
        'MongoDB Atlas connection failed: Your current IP address is not whitelisted in the MongoDB Atlas Network Access list, or DNS/network timed out. Retrying in background...'
      );
    } else {
      logger.error(
        {
          uri: sanitizeMongoUri(uri),
          err: error instanceof Error ? error.message : String(error),
        },
        'Failed to connect to MongoDB. Retrying in background...'
      );
    }
    scheduleReconnect(5000);
    return false;
  }
};
