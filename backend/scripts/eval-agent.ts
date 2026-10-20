import { randomBytes } from 'node:crypto';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import '../src/core/config/dotenv';
import { connectDB, disconnectDB } from '../src/core/config/db';
import { loadEnv } from '../src/core/config/env';
import { buildContainer } from '../src/core/container';
import { formatScorecard, prepareFixture, runSuite } from '../src/modules/agent/evals/runner';
import { SCENARIOS } from '../src/modules/agent/evals/scenarios';
import { LLMProviderFactory } from '../src/modules/agent/llm/llm-provider.factory';

/**
 * Runs the agent eval scenarios against the configured real model (ANTHROPIC_API_KEY or
 * GROQ_API_KEY) on a throwaway in-memory database and prints a scorecard.
 * `--strict` exits non-zero when any check fails.
 */
async function main() {
  process.env.JWT_SECRET ??= randomBytes(32).toString('hex');
  process.env.RATE_LIMIT_ENABLED = 'false';
  const provider = LLMProviderFactory.create(loadEnv({ ...process.env, MONGO_URL: process.env.MONGO_URL || 'mongodb://unused' }));
  if (!provider) {
    console.log('No model configured (set ANTHROPIC_API_KEY or GROQ_API_KEY); skipping the live agent eval.');
    return;
  }
  const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  process.env.MONGO_URL = replSet.getUri();
  process.env.DB_NAME = 'storefront_eval';
  const env = loadEnv();
  try {
    await connectDB(env.MONGO_URL, env.DB_NAME);
    await Promise.all(Object.values(mongoose.models).map(m => m.syncIndexes()));
    const container = buildContainer(env);
    const fx = await prepareFixture(container);
    const started = Date.now();
    const results = await runSuite(fx, SCENARIOS, () => provider);
    console.log(formatScorecard(results, `${provider.name}/${provider.model}`));
    console.log(`Finished in ${((Date.now() - started) / 1000).toFixed(1)}s`);
    if (process.argv.includes('--strict') && results.some(r => !r.pass)) process.exitCode = 1;
  } finally {
    await disconnectDB();
    await replSet.stop();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
