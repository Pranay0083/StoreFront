import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadEnv } from '../src/core/config/env';
import { buildContainer } from '../src/core/container';

const target = fileURLToPath(new URL('../openapi.json', import.meta.url));
const check = process.argv.includes('--check');

const env = loadEnv({
  NODE_ENV: 'test',
  MONGO_URL: 'mongodb://127.0.0.1:27017',
  JWT_SECRET: 'openapi-generation-only-not-a-real-secret',
  LOG_LEVEL: 'silent',
});
const spec = `${JSON.stringify(buildContainer(env).docs.spec(), null, 2)}\n`;

if (check) {
  let committed = '';
  try {
    committed = readFileSync(target, 'utf8');
  } catch {
    // treated as out of date below
  }
  if (committed !== spec) {
    console.error('backend/openapi.json is out of date. Run `npm run openapi:generate -w backend` and commit the result.');
    process.exit(1);
  }
  console.log('backend/openapi.json is up to date.');
} else {
  writeFileSync(target, spec);
  console.log(`Wrote ${target}`);
}
process.exit(0);
