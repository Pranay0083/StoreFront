// Server-side view of the last run from Prometheus. Usage: node loadtest/setup/metrics.mjs [window=3m]
const PROM = process.env.PROMETHEUS_URL || 'http://localhost:9090';
const w = process.argv[2] || '3m';

const QUERIES = {
  'cache hit ratio (all)': `sum(increase(storefront_cache_requests_total{result="hit"}[${w}])) / sum(increase(storefront_cache_requests_total[${w}]))`,
  'cache hit ratio by cache': `sum by (cache) (increase(storefront_cache_requests_total{result="hit"}[${w}])) / sum by (cache) (increase(storefront_cache_requests_total[${w}]))`,
  'pricing p50 (ms)': `1000 * histogram_quantile(0.50, sum by (le) (rate(storefront_pricing_duration_seconds_bucket[${w}])))`,
  'pricing p95 (ms)': `1000 * histogram_quantile(0.95, sum by (le) (rate(storefront_pricing_duration_seconds_bucket[${w}])))`,
  'pricing runs by strategy': `sum by (strategy) (increase(storefront_pricing_duration_seconds_count[${w}]))`,
  'optimizer nodes p95': `histogram_quantile(0.95, sum by (le) (rate(storefront_pricing_optimizer_nodes_bucket[${w}])))`,
  'api p95 by route (ms)': `topk(8, 1000 * histogram_quantile(0.95, sum by (le, route) (rate(http_request_duration_seconds_bucket{job="storefront-api"}[${w}]))))`,
  'api requests/s': `sum(rate(http_request_duration_seconds_count{job="storefront-api"}[${w}]))`,
  'api 5xx/s': `sum(rate(http_request_duration_seconds_count{job="storefront-api",status=~"5.."}[${w}]))`,
  'jobs by outcome': `sum by (job, outcome) (increase(storefront_jobs_total[${w}]))`,
  'payments captured': `sum(increase(storefront_payments_captured_total[${w}]))`,
  'event loop lag p99 (ms)': `1000 * max by (job) (nodejs_eventloop_lag_p99_seconds)`,
  'resident memory (MB)': `max by (job) (process_resident_memory_bytes) / 1e6`,
  'cpu cores used': `sum by (job) (rate(process_cpu_seconds_total[${w}]))`,
};

for (const [label, query] of Object.entries(QUERIES)) {
  const res = await fetch(`${PROM}/api/v1/query?query=${encodeURIComponent(query)}`);
  const body = await res.json();
  const rows = (body.data?.result ?? []).map(r => {
    const tags = Object.entries(r.metric)
      .filter(([k]) => !['instance', '__name__'].includes(k))
      .map(([k, v]) => `${k}=${v}`)
      .join(',');
    const value = Number(r.value[1]);
    return `${tags || '-'}: ${Number.isFinite(value) ? (Math.abs(value) < 10 ? value.toFixed(3) : value.toFixed(1)) : r.value[1]}`;
  });
  console.log(`${label.padEnd(28)} ${rows.join(' | ') || 'n/a'}`);
}
