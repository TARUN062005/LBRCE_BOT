import mongoose from 'mongoose';
import { getEnv } from './env.js';
import { logger } from '../utils/logger.js';

export async function connectDb(): Promise<typeof mongoose> {
  const env = getEnv();
  mongoose.set('strictQuery', true);
  await mongoose.connect(env.MONGODB_URI, {
    maxPoolSize: 20,
    serverSelectionTimeoutMS: 8000,
  });
  logger.info('MongoDB connected');
  return mongoose;
}

export async function disconnectDb(): Promise<void> {
  await mongoose.disconnect();
}
