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

export const connectDB = async (): Promise<boolean> => {
  const uri = env.MONGODB_URI;

  try {
    mongoose.connection.on('connected', () => {
      logger.info('MongoDB connection established successfully');
    });

    mongoose.connection.on('error', (err) => {
      logger.error({ err }, 'MongoDB runtime error');
    });

    mongoose.connection.on('disconnected', () => {
      logger.warn('MongoDB connection disconnected');
    });

    await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
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
        'MongoDB Atlas connection failed: Your current IP address is not whitelisted in the MongoDB Atlas Network Access list. To resolve: Log into cloud.mongodb.com -> Network Access -> Add IP Address -> Add Current IP Address (or 0.0.0.0/0 for dev).'
      );
    } else {
      logger.error(
        {
          uri: sanitizeMongoUri(uri),
          err: error instanceof Error ? error.message : String(error),
        },
        'Failed to connect to MongoDB'
      );
    }
    return false;
  }
};
