import { latencyThresholds, loadCatalog } from '../lib/common.js';
import browse from './browse.js';
import quote from './pricing.js';
import search from './search.js';

// Steady mixed traffic for a long window, to surface leaks, pool exhaustion and queue growth.
const RATE = Number(__ENV.RATE || 80);
const DURATION = __ENV.DURATION || '30m';

export const options = {
  scenarios: {
    browse: {
      executor: 'constant-arrival-rate',
      exec: 'browsing',
      rate: Math.round(RATE * 0.7),
      timeUnit: '1s',
      duration: DURATION,
      preAllocatedVUs: 40,
      maxVUs: 200,
    },
    search: {
      executor: 'constant-arrival-rate',
      exec: 'searching',
      rate: Math.round(RATE * 0.2),
      timeUnit: '1s',
      duration: DURATION,
      preAllocatedVUs: 15,
      maxVUs: 100,
    },
    quotes: {
      executor: 'constant-arrival-rate',
      exec: 'quoting',
      rate: Math.max(1, Math.round(RATE * 0.1)),
      timeUnit: '1s',
      duration: DURATION,
      preAllocatedVUs: 10,
      maxVUs: 100,
    },
  },
  thresholds: latencyThresholds(300, 800),
};

export function setup() {
  const catalog = loadCatalog();
  const words = [...new Set(catalog.products.flatMap(p => p.title.toLowerCase().split(/\s+/)).filter(w => w.length > 3))];
  const products = catalog.products.filter(p => p.sizes.length > 0);
  return { ...catalog, products, promoted: products.filter(p => !/-\d+$/.test(p.slug)), words };
}

export const browsing = data => browse(data);
export const searching = data => search(data);
export const quoting = data => quote(data);
