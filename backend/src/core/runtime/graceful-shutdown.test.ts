import { createServer } from 'node:http';
import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';
import { runsJobsInProcess } from '../infrastructure';
import { closeHttpServer, GracefulShutdown } from './graceful-shutdown';

const silent = pino({ level: 'silent' });

describe('GracefulShutdown', () => {
  it('runs hooks in order once, even if signalled twice, and exits cleanly', async () => {
    const order: string[] = [];
    const exit = vi.fn();
    const shutdown = new GracefulShutdown(silent, 1_000, exit)
      .onBegin(() => order.push('begin'))
      .add('http', async () => void order.push('http'))
      .add('workers', async () => void order.push('workers'));
    await Promise.all([shutdown.shutdown('SIGTERM'), shutdown.shutdown('SIGINT')]);
    expect(order).toEqual(['begin', 'http', 'workers']);
    expect(exit).toHaveBeenCalledExactlyOnceWith(0);
  });

  it('keeps going after a failing step and exits non-zero', async () => {
    const exit = vi.fn();
    const later = vi.fn();
    await new GracefulShutdown(silent, 1_000, exit)
      .add('broken', () => Promise.reject(new Error('nope')))
      .add('later', later)
      .shutdown('test');
    expect(later).toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('forces exit when a step hangs past the deadline', async () => {
    const exit = vi.fn();
    void new GracefulShutdown(silent, 20, exit).add('stuck', () => new Promise(() => undefined)).shutdown('test');
    await new Promise(r => setTimeout(r, 60));
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('closes an HTTP server after in-flight requests finish', async () => {
    let finish!: () => void;
    const server = createServer((_req, res) => {
      finish = () => res.end('done');
    });
    await new Promise<void>(r => server.listen(0, r));
    const port = (server.address() as { port: number }).port;
    const response = fetch(`http://127.0.0.1:${port}/`).then(r => r.text());
    await new Promise(r => setTimeout(r, 30));
    const closed = closeHttpServer(server);
    finish();
    expect(await response).toBe('done');
    await closed;
    expect(server.listening).toBe(false);
  });
});

describe('runsJobsInProcess', () => {
  it('runs jobs in the API only when there is no shared queue, unless overridden', () => {
    expect(runsJobsInProcess({ JOBS_IN_PROCESS: 'auto' }, { kind: 'memory' })).toBe(true);
    expect(runsJobsInProcess({ JOBS_IN_PROCESS: 'auto' }, { kind: 'redis' })).toBe(false);
    expect(runsJobsInProcess({ JOBS_IN_PROCESS: 'true' }, { kind: 'redis' })).toBe(true);
    expect(runsJobsInProcess({ JOBS_IN_PROCESS: 'false' }, { kind: 'memory' })).toBe(false);
  });
});
