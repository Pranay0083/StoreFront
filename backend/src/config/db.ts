import mongoose from 'mongoose';
import { env } from './env';

/**
 * Establishes connection to the MongoDB database using Mongoose.
 */
export async function connectDB() {
  await mongoose.connect(env.MONGO_URL, { dbName: env.DB_NAME });
  console.log(`[db] connected to ${env.DB_NAME}`);
}
