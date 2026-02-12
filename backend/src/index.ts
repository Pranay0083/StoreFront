import { createApp } from './app';
import { connectDB } from './db';
import { env } from './env';
import { seedIfNeeded } from './seed';

async function main() {
  await connectDB();
  await seedIfNeeded();
  const host = process.env.HOST || '127.0.0.1';
  createApp().listen(env.PORT, host, () => {
    console.log(`[api] storefront-api listening on ${host}:${env.PORT}`);
  });
}

main().catch(err => {
  console.error('[fatal]', err);
  process.exit(1);
});
