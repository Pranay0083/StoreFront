import mongoose from 'mongoose';
import { env } from './env';

export async function connectDB() {
  await mongoose.connect(env.MONGO_URL, { dbName: env.DB_NAME });
  console.log(`[db] connected to ${env.DB_NAME}`);
}
