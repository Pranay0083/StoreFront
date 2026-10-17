import type { Server } from 'node:http';
import type { Logger } from 'pino';

type Hook = { name: string; run: () => Promise<unknown> | unknown };

/**
 * Runs shutdown hooks in registration order (stop accepting work, drain in-flight work, close
 * connections), bounded by a deadline so a stuck dependency can never block a deploy forever.
 */
export class GracefulShutdown {
  private readonly hooks: Hook[] = [];
  private readonly beginListeners: Array<() => void> = [];
  private started?: Promise<void>;

  constructor(
    private readonly logger: Logger,
    private readonly timeoutMs: number,
    private readonly exit: (code: number) => void = code => process.exit(code),
  ) {}

  onBegin(listener: () => void): this {
    this.beginListeners.push(listener);
    return this;
  }

  add(name: string, run: Hook['run']): this {
    this.hooks.push({ name, run });
    return this;
  }

  listen(signals: NodeJS.Signals[] = ['SIGTERM', 'SIGINT']): this {
    for (const signal of signals) process.once(signal, () => void this.shutdown(signal));
    return this;
  }

  shutdown(reason: string): Promise<void> {
    this.started ??= this.run(reason);
    return this.started;
  }

  private async run(reason: string): Promise<void> {
    this.logger.info({ reason }, 'Graceful shutdown started');
    for (const listener of this.beginListeners) listener();
    const deadline = setTimeout(() => {
      this.logger.error({ timeoutMs: this.timeoutMs }, 'Graceful shutdown timed out; forcing exit');
      this.exit(1);
    }, this.timeoutMs);
    deadline.unref();
    let code = 0;
    for (const hook of this.hooks) {
      try {
        await hook.run();
        this.logger.info({ step: hook.name }, 'Shutdown step complete');
      } catch (err) {
        code = 1;
        this.logger.error({ err, step: hook.name }, 'Shutdown step failed');
      }
    }
    clearTimeout(deadline);
    this.logger.info('Shutdown complete');
    this.exit(code);
  }
}

/** Stops accepting connections and waits for in-flight requests; idle keep-alive sockets are closed at once. */
export function closeHttpServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close(err => (err ? reject(err) : resolve()));
    server.closeIdleConnections();
  });
}
