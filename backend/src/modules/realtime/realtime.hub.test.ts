import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { LocalPubSub } from '../../core/pubsub';
import { RealtimeHub } from './realtime.hub';

const logger = pino({ level: 'silent' });
const flush = () => new Promise(r => setTimeout(r, 5));

function client() {
  const chunks: string[] = [];
  return {
    chunks,
    ended: false,
    write(chunk: string) {
      chunks.push(chunk);
    },
    end() {
      this.ended = true;
    },
    events: () => chunks.filter(c => c.startsWith('id:')),
  };
}

describe('RealtimeHub', () => {
  it('fans out across instances sharing pub/sub and filters by channel', async () => {
    const pubsub = new LocalPubSub();
    const api1 = new RealtimeHub(pubsub, logger);
    const api2 = new RealtimeHub(pubsub, logger);
    const worker = new RealtimeHub(pubsub, logger);
    await Promise.all([api1.listen(), api2.listen()]);
    const a = client();
    const b = client();
    const other = client();
    api1.attach(a, ['orders:user:1']);
    api2.attach(b, ['orders:user:1']);
    api2.attach(other, ['orders:user:2']);

    await worker.publish('orders:user:1', 'order.status', { orderId: 'o1', status: 'paid' });
    await flush();
    expect(a.events()).toHaveLength(1);
    expect(b.events()).toHaveLength(1);
    expect(other.events()).toHaveLength(0);
    expect(a.events()[0]).toMatch(
      /^id: \d+-\d+\nevent: order\.status\ndata: \{"channel":"orders:user:1","orderId":"o1","status":"paid"\}\n\n$/,
    );
    expect(a.chunks[0]).toBe('retry: 5000\n\n');
  });

  it('replays missed messages after Last-Event-ID, in order, from a bounded buffer', async () => {
    const pubsub = new LocalPubSub();
    const hub = new RealtimeHub(pubsub, logger, { bufferSize: 3, heartbeatMs: 60_000 });
    await hub.listen();
    for (let i = 0; i < 5; i++) await hub.publish('admin:orders', 'order.placed', { n: i });
    await flush();

    const fresh = client();
    hub.attach(fresh, ['admin:orders']);
    expect(fresh.events()).toHaveLength(0);

    const all = client();
    hub.attach(all, ['admin:orders'], '0-0');
    expect(all.events().map(e => JSON.parse(e.split('data: ')[1]).n)).toEqual([2, 3, 4]);

    const resumed = client();
    const thirdId = /^id: (\S+)/.exec(all.events()[1])![1];
    hub.attach(resumed, ['admin:orders'], thirdId);
    expect(resumed.events().map(e => JSON.parse(e.split('data: ')[1]).n)).toEqual([4]);
  });

  it('sends heartbeats and ends streams on close', async () => {
    const hub = new RealtimeHub(new LocalPubSub(), logger, { bufferSize: 10, heartbeatMs: 10 });
    const c = client();
    hub.attach(c, ['x']);
    await new Promise(r => setTimeout(r, 35));
    expect(c.chunks.some(chunk => chunk.startsWith(': ping'))).toBe(true);
    hub.close();
    expect(c.ended).toBe(true);
    expect(hub.connections).toBe(0);
  });
});
