import '../../core/config/dotenv';
import { connectDB, disconnectDB } from '../../core/config/db';
import { loadEnv } from '../../core/config/env';
import { ProductRepository } from '../catalog/product.repository';
import { createSearchProvider } from './search.factory';
import { SearchService } from './search.service';

/** `npm run search:reindex`: (re)creates the search index settings and indexes every product in batches. */
try {
  const env = loadEnv();
  await connectDB(env.MONGO_URL, env.DB_NAME);
  const provider = createSearchProvider(env, { waitForTasks: true });
  const started = Date.now();
  const indexed = await new SearchService(provider, new ProductRepository()).reindexAll();
  console.log(`[search] ${provider.name}: indexed ${indexed} products in ${Date.now() - started}ms`);
  await disconnectDB();
} catch (err) {
  console.error('[search] Reindex failed\n', err instanceof Error ? err.message : err);
  process.exit(1);
}
