// Uncached catalog listing cost straight from Mongo, as the API issues it (page + total count).
// Run inside the compose Mongo container: mongosh storefront --quiet loadtest/setup/listing-bench.js
const SORTS = {
  newest: { createdAt: -1, _id: -1 },
  'price-asc': { price: 1, _id: 1 },
  'price-desc': { price: -1, _id: -1 },
  rating: { rating: -1, _id: -1 },
};
const FILTERS = [{}, { category: 'Men' }, { category: 'Footwear' }];
const ROUNDS = 30;
const rows = [];
for (const [name, sort] of Object.entries(SORTS)) {
  for (const filter of FILTERS) {
    const timings = [];
    for (let i = 0; i < ROUNDS; i++) {
      const t = Date.now();
      db.products.find(filter).sort(sort).limit(24).toArray();
      db.products.countDocuments(filter);
      timings.push(Date.now() - t);
    }
    timings.sort((a, b) => a - b);
    const stats = db.products.find(filter).sort(sort).limit(24).explain('executionStats').executionStats;
    rows.push({
      sort: name,
      filter: filter.category || 'all',
      p50ms: timings[Math.floor(ROUNDS / 2)],
      p95ms: timings[Math.floor(ROUNDS * 0.95)],
      docsExamined: stats.totalDocsExamined,
    });
  }
}
print(JSON.stringify({ products: db.products.estimatedDocumentCount(), rows }));
