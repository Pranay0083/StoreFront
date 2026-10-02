import '../core/config/dotenv';
import mongoose from 'mongoose';
import { connectDB, disconnectDB } from '../core/config/db';
import { loadEnv } from '../core/config/env';
import { logger } from '../core/logger';
import { migrations } from './migrations';
import { Migrator } from './migrator';
import { seedDemoData } from './seed/demo-seeder';

const COMMANDS = ['migrate', 'seed', 'setup', 'status'] as const;
type Command = (typeof COMMANDS)[number];

async function run(command: Command) {
  const env = loadEnv();
  await connectDB(env.MONGO_URL, env.DB_NAME);
  try {
    const migrator = new Migrator(mongoose.connection.db!, migrations);
    if (command === 'status') {
      console.table(await migrator.status());
      return;
    }
    if (command === 'migrate' || command === 'setup') {
      const ran = await migrator.up();
      logger.info({ applied: ran }, ran.length ? 'Migrations applied' : 'No pending migrations');
    }
    if (command === 'seed' || (command === 'setup' && env.SEED_DEMO_DATA)) {
      await seedDemoData(env);
    }
  } finally {
    await disconnectDB();
  }
}

const command = (process.argv[2] ?? 'setup') as Command;
if (!COMMANDS.includes(command)) {
  console.error(`Unknown command "${command}". Use one of: ${COMMANDS.join(', ')}`);
  process.exit(1);
}

try {
  await run(command);
} catch (err) {
  console.error('[fatal] Database task failed\n', err instanceof Error ? err.message : err);
  process.exit(1);
}
