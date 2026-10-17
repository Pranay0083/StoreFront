import { register } from 'node:module';

/**
 * Loaded with `--import` before the application so modules are patched as they load. Tracing is
 * off unless OTEL_EXPORTER_OTLP_ENDPOINT is set (or OTEL_TRACES_EXPORTER=console for local debugging),
 * so the default deploy pays nothing for it.
 */
const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
const toConsole = process.env.OTEL_TRACES_EXPORTER === 'console';
const IGNORED_PATHS = new Set(['/health', '/ready', '/metrics']);

let shutdown: () => Promise<void> = async () => {};

if (endpoint || toConsole) {
  const { createAddHookMessageChannel } = await import('import-in-the-middle');
  const { registerOptions, waitForAllMessagesAcknowledged } = createAddHookMessageChannel();
  register('import-in-the-middle/hook.mjs', import.meta.url, registerOptions);

  const [{ NodeSDK }, { OTLPTraceExporter }, { ConsoleSpanExporter }, { resourceFromAttributes }, http, express, mongodb, ioredis] =
    await Promise.all([
      import('@opentelemetry/sdk-node'),
      import('@opentelemetry/exporter-trace-otlp-http'),
      import('@opentelemetry/sdk-trace-base'),
      import('@opentelemetry/resources'),
      import('@opentelemetry/instrumentation-http'),
      import('@opentelemetry/instrumentation-express'),
      import('@opentelemetry/instrumentation-mongodb'),
      import('@opentelemetry/instrumentation-ioredis'),
    ]);

  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      'service.name': process.env.OTEL_SERVICE_NAME ?? 'storefront-api',
      'deployment.environment.name': process.env.NODE_ENV ?? 'development',
    }),
    traceExporter: toConsole ? new ConsoleSpanExporter() : new OTLPTraceExporter(),
    instrumentations: [
      new http.HttpInstrumentation({ ignoreIncomingRequestHook: req => IGNORED_PATHS.has((req.url ?? '').split('?')[0]) }),
      new express.ExpressInstrumentation(),
      new mongodb.MongoDBInstrumentation({ enhancedDatabaseReporting: false }),
      new ioredis.IORedisInstrumentation(),
    ],
  });
  sdk.start();
  await waitForAllMessagesAcknowledged();
  shutdown = () => sdk.shutdown();
  console.info(`[otel] tracing enabled (${toConsole ? 'console' : endpoint})`);
}

/** Flushes buffered spans; registered as the last graceful-shutdown step. */
export function shutdownTracing(): Promise<void> {
  return shutdown();
}

export const tracingEnabled = Boolean(endpoint || toConsole);
