// Post-run correctness checks. Usage: node loadtest/setup/verify.mjs <checkout|webhooks>
import { adminToken, call, mongo, readData } from './lib.mjs';

const mode = process.argv[2];
const admin = await adminToken();
const failures = [];
const expect = (ok, message) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${message}`);
  if (!ok) failures.push(message);
};

// Side effects run asynchronously in the worker; wait until the outbox and queues have drained.
const started = Date.now();
for (;;) {
  const o = await call('GET', '/admin/jobs', { token: admin });
  const inFlight =
    (o.outbox.pending ?? 0) +
    (o.outbox.processing ?? 0) +
    (o.outbox.dispatched ?? 0) +
    o.queues.reduce((s, q) => s + q.waiting + q.active, 0);
  if (inFlight === 0) {
    console.log(`queues drained after ${((Date.now() - started) / 1000).toFixed(1)}s: ${JSON.stringify(o.outbox)}`);
    break;
  }
  if (Date.now() - started > 120_000) {
    expect(false, `queues still busy after 120s: ${JSON.stringify(o)}`);
    break;
  }
  await new Promise(r => setTimeout(r, 1000));
}

if (mode === 'checkout') {
  const f = readData('checkout.json');
  const r = mongo(`
    const pid = ObjectId('${f.productId}');
    const orders = db.orders.aggregate([{ $match: { 'items.productId': pid } }, { $group: { _id: '$status', n: { $sum: 1 }, units: { $sum: { $sum: '$items.qty' } } } }]).toArray();
    const product = db.products.findOne({ _id: pid });
    const movements = db.inventorymovements.aggregate([{ $match: { productId: pid } }, { $group: { _id: '$type', n: { $sum: 1 }, delta: { $sum: '$delta' } } }]).toArray();
    const reservations = db.stockreservations.aggregate([{ $match: { 'items.productId': pid } }, { $group: { _id: '$status', n: { $sum: 1 } } }]).toArray();
    print(JSON.stringify({ orders, stock: product.sizes[0].stock, movements, reservations }));
  `);
  console.log(JSON.stringify(r));
  const byStatus = Object.fromEntries(r.orders.map(o => [o._id, o]));
  const paidUnits = byStatus.paid?.units ?? 0;
  expect(paidUnits === f.stock, `exactly ${f.stock} units sold (got ${paidUnits})`);
  expect(r.orders.reduce((s, o) => s + o.n, 0) === f.stock, `exactly ${f.stock} orders exist for the hot SKU`);
  expect(r.stock === 0, `hot SKU stock is 0, never negative (got ${r.stock})`);
} else if (mode === 'webhooks') {
  const f = readData('webhooks.json');
  const ids = f.orders.map(o => o.orderId);
  const r = mongo(`
    const ids = ${JSON.stringify(ids)}.map(id => ObjectId(id));
    const orders = db.orders.find({ _id: { $in: ids } }, { status: 1, statusHistory: 1, 'payment.razorpayPaymentId': 1 }).toArray();
    const paidTransitions = orders.map(o => o.statusHistory.filter(h => h.to === 'paid').length);
    const outbox = db.outbox.aggregate([{ $match: { name: 'OrderPaid', 'payload.orderId': { $in: ${JSON.stringify(ids)} } } }, { $group: { _id: '$payload.orderId', n: { $sum: 1 } } }]).toArray();
    const sales = db.inventorymovements.aggregate([{ $match: { orderId: { $in: ids }, type: 'SALE' } }, { $group: { _id: '$orderId', n: { $sum: 1 } } }]).toArray();
    const events = db.webhookevents.countDocuments({ eventId: { $regex: '^evt_lt${f.run}' } });
    print(JSON.stringify({
      paid: orders.filter(o => o.status === 'paid').length,
      maxPaidTransitions: Math.max(...paidTransitions),
      minPaidTransitions: Math.min(...paidTransitions),
      outboxMax: Math.max(0, ...outbox.map(o => o.n)),
      outboxOrders: outbox.length,
      salesMax: Math.max(0, ...sales.map(s => s.n)),
      salesOrders: sales.length,
      events,
    }));
  `);
  console.log(JSON.stringify(r));
  const n = ids.length;
  expect(r.paid === n, `all ${n} webhook orders are paid (got ${r.paid})`);
  expect(r.maxPaidTransitions === 1 && r.minPaidTransitions === 1, 'each order recorded exactly one paid transition');
  expect(r.outboxOrders === n && r.outboxMax === 1, 'exactly one OrderPaid event per order');
  expect(r.salesOrders === n && r.salesMax === 1, 'exactly one SALE movement per order');
  expect(r.events === n, `one webhook event row per distinct event (got ${r.events})`);
} else {
  console.error('usage: verify.mjs <checkout|webhooks>');
  process.exit(1);
}

const reconcile = await call('GET', '/admin/inventory/reconcile', { token: admin });
expect(reconcile.ok, `ledger reconciles: ${reconcile.variantsChecked} variants, ${reconcile.mismatches.length} mismatches`);
const dlq = await call('GET', '/admin/jobs/dead-letters', { token: admin });
const dead = dlq.items ?? dlq.deadLetters ?? dlq;
console.log(`dead letters: ${JSON.stringify(dead).slice(0, 500)}`);
expect(Array.isArray(dead) ? dead.length === 0 : true, 'dead-letter queue is empty');

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log('\nall correctness checks passed');
