import mongoose from 'mongoose';

export async function connectDB(url: string, dbName: string) {
  await mongoose.connect(url, { dbName });
  return mongoose.connection;
}

export async function disconnectDB() {
  await mongoose.disconnect();
}
