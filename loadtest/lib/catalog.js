import { SharedArray } from 'k6/data';

// Written by `fixtures.mjs snapshot`. SharedArray keeps one read-only copy for all VUs; returning a
// large catalog from setup() would copy it into every VU instead.
const load = () => JSON.parse(open('../.data/catalog.json'));

export const products = new SharedArray('products', () => load().products);
export const categories = new SharedArray('categories', () => load().categories);
export const inStock = new SharedArray('in-stock', () => load().products.filter(p => p.sizes.length > 0));
// Demo-seeded products are the ones the seeded promotions target; load-test fillers end in "-<n>".
export const promoted = new SharedArray('promoted', () => load().products.filter(p => p.sizes.length > 0 && !/-\d+$/.test(p.slug)));
export const words = new SharedArray('words', () => [
  ...new Set(
    load()
      .products.flatMap(p => p.title.toLowerCase().split(/\s+/))
      .filter(w => w.length > 3 && !/\d/.test(w)),
  ),
]);
