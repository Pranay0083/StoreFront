import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DATA_DIR = join(ROOT, 'loadtest', '.data');
export const API = `${process.env.HOST_BASE_URL || 'http://localhost:4001'}/api/v1`;
export const DB_NAME = process.env.DB_NAME || 'storefront';

export const ADDRESS = {
  name: 'Load Test',
  line1: '12 Residency Road',
  city: 'Bengaluru',
  state: 'KA',
  pincode: '560025',
  phone: '9876543210',
};

export async function call(method, path, { token, body, headers = {} } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
  return data;
}

export const idempotencyKey = () => ({ 'Idempotency-Key': randomUUID() });

export async function adminToken() {
  const email = process.env.ADMIN_EMAIL || 'admin@storefront.dev';
  const password = process.env.ADMIN_PASSWORD || 'Admin@12345';
  return (await call('POST', '/auth/login', { body: { email, password } })).token;
}

export async function inBatches(items, size, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  }
  return out;
}

export async function registerBuyers(run, count) {
  return inBatches([...Array(count).keys()], 20, async i => {
    const res = await call('POST', '/auth/register', {
      body: { name: `Load Buyer ${i}`, email: `lt-${run}-${i}@load.test`, password: 'LoadTest@12345' },
    });
    return res.token;
  });
}

export async function createProduct(token, title, stock) {
  return call('POST', '/products', {
    token,
    body: {
      title,
      category: 'Men',
      price: 149_900,
      images: ['https://images.unsplash.com/photo-1521572163474-6864f9cf17ab'],
      sizes: [{ size: 'M', stock }],
    },
  });
}

/** Runs a script in the compose Mongo container (the replica set is only reachable on the compose network). */
export function mongo(script) {
  const files = ['-f', join(ROOT, 'docker-compose.yml'), '-f', join(ROOT, 'loadtest', 'docker-compose.loadtest.yml')];
  const out = execFileSync('docker', ['compose', ...files, 'exec', '-T', 'mongo', 'mongosh', DB_NAME, '--quiet', '--eval', script], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(out.trim().split('\n').at(-1));
}

export function writeData(name, data) {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(join(DATA_DIR, name), JSON.stringify(data, null, 2));
}

export const readData = name => JSON.parse(readFileSync(join(DATA_DIR, name), 'utf8'));
