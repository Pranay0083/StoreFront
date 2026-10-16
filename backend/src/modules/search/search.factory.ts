import { MeilisearchProvider } from './meilisearch.search';
import { MongoTextSearch } from './mongo-text.search';
import type { SearchProvider } from './search.provider';

export function createSearchProvider(
  config: { MEILI_URL?: string; MEILI_API_KEY?: string; MEILI_INDEX: string },
  options: { waitForTasks?: boolean } = {},
): SearchProvider {
  if (!config.MEILI_URL) return new MongoTextSearch();
  return new MeilisearchProvider({ host: config.MEILI_URL, apiKey: config.MEILI_API_KEY }, config.MEILI_INDEX, options.waitForTasks);
}
