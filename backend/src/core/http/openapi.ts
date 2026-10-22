import { OpenAPIRegistry, OpenApiGeneratorV31, extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import type { RequestHandler, Router } from 'express';
import { z, type ZodTypeAny } from 'zod';
import { ACCESS_COOKIE } from './cookies';
import type { Schemas } from './validate';

extendZodWithOpenApi(z);

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';
const METHODS: readonly Method[] = ['get', 'post', 'put', 'patch', 'delete'];

interface Layer {
  handle: RequestHandler & { schemas?: Schemas; permissions?: string[]; role?: string };
  route?: { path: string; methods: Record<string, boolean>; stack: Layer[] };
}

export interface AuthMarkers {
  required: readonly RequestHandler[];
  optional: readonly RequestHandler[];
  staff: readonly RequestHandler[];
}

export interface OperationOverride {
  summary?: string;
  requestContentType?: string;
  responseContentType?: string;
  requestSchema?: Record<string, unknown>;
}

export interface OpenApiOptions {
  title: string;
  version: string;
  serverUrl: string;
  auth: AuthMarkers;
  /** Keyed by `METHOD /path` with OpenAPI-style `{param}` placeholders. */
  overrides?: Record<string, OperationOverride>;
  exclude?: (path: string) => boolean;
}

export interface OpenApiDocument {
  openapi: string;
  paths: Record<string, Record<string, unknown>>;
  [key: string]: unknown;
}

const ApiErrorSchema = z
  .object({
    error: z.string(),
    code: z.string().optional(),
    details: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  })
  .openapi('ApiError');

const ERROR_RESPONSES = {
  400: 'Validation failed or the request is malformed',
  401: 'Missing or invalid credentials',
  403: 'Authenticated but not allowed (permission or CSRF)',
  404: 'Resource not found',
  409: 'Conflicts with the current state',
  429: 'Rate limited',
};

const sanitized = new WeakMap<ZodTypeAny, ZodTypeAny>();

/**
 * Rewrites a schema into the subset the generator understands, describing what clients send:
 * `.catch()` fallbacks and transforms document their input type, and recursive `z.lazy` trees
 * become an opaque object (their structure is documented by the contracts package).
 */
export function documentable(schema: ZodTypeAny): ZodTypeAny {
  const cached = sanitized.get(schema);
  if (cached) return cached;
  let out: ZodTypeAny;
  if (schema instanceof z.ZodLazy)
    out = z.object({}).passthrough().openapi({ description: 'Recursive structure; see @storefront/contracts' });
  else if (schema instanceof z.ZodCatch) out = documentable(schema._def.innerType).optional();
  else if (schema instanceof z.ZodEffects) out = documentable(schema.innerType());
  else if (schema instanceof z.ZodPipeline) out = documentable(schema._def.in);
  else if (schema instanceof z.ZodOptional) out = documentable(schema.unwrap()).optional();
  else if (schema instanceof z.ZodNullable) out = documentable(schema.unwrap()).nullable();
  else if (schema instanceof z.ZodDefault) out = documentable(schema.removeDefault()).default(schema._def.defaultValue());
  else if (schema instanceof z.ZodArray) out = z.array(documentable(schema.element));
  else if (schema instanceof z.ZodRecord) out = z.record(documentable(schema.valueSchema));
  else if (schema instanceof z.ZodObject) {
    const shape = Object.fromEntries(Object.entries(schema.shape as Record<string, ZodTypeAny>).map(([k, v]) => [k, documentable(v)]));
    out = schema._def.unknownKeys === 'strict' ? z.object(shape).strict() : z.object(shape);
  } else if (schema instanceof z.ZodDiscriminatedUnion || schema instanceof z.ZodUnion) {
    const options = [...(schema.options as Iterable<ZodTypeAny>)].map(documentable);
    out = options.length > 1 ? z.union(options as [ZodTypeAny, ZodTypeAny, ...ZodTypeAny[]]) : options[0];
  } else if (schema instanceof z.ZodIntersection) out = z.intersection(documentable(schema._def.left), documentable(schema._def.right));
  else out = schema;
  if (schema.description && !out.description) out = out.describe(schema.description);
  sanitized.set(schema, out);
  return out;
}

/** Unwraps refinements/transforms so query and params schemas can be expanded parameter by parameter. */
function asObject(schema: ZodTypeAny | undefined): z.AnyZodObject | undefined {
  let current: ZodTypeAny | undefined = schema ? documentable(schema) : undefined;
  for (let i = 0; i < 5 && current; i++) {
    if (current instanceof z.ZodObject) return current;
    if (current instanceof z.ZodEffects) current = current.innerType();
    else if (current instanceof z.ZodPipeline) current = current._def.in;
    else if (current instanceof z.ZodDefault || current instanceof z.ZodOptional) current = current._def.innerType;
    else return undefined;
  }
  return undefined;
}

const toOpenApiPath = (path: string) => path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
const joinPath = (...parts: string[]) =>
  `/${parts
    .map(p => p.replace(/^\/|\/$/g, ''))
    .filter(Boolean)
    .join('/')}`;

const operationId = (method: string, path: string) =>
  method +
  path
    .split('/')
    .filter(Boolean)
    .map(seg => seg.replace(/[{}]/g, '').replace(/[^A-Za-z0-9]+(.)?/g, (_, c: string | undefined) => (c ? c.toUpperCase() : '')))
    .map(seg => seg.charAt(0).toUpperCase() + seg.slice(1))
    .join('');

const tagFor = (mount: string) => {
  const [first, second] = mount.split('/').filter(Boolean);
  return first === 'admin' && second ? `admin/${second}` : (first ?? 'root');
};

/**
 * Generates an OpenAPI 3.1 document from the routers themselves: paths and methods come from the
 * Express route table, request schemas from the zod schemas attached by `validate()`, and security
 * requirements from the auth guards on each route, so the spec cannot drift from the code.
 */
export function generateOpenApi(routes: ReadonlyArray<readonly [string, Router]>, options: OpenApiOptions): OpenApiDocument {
  const registry = new OpenAPIRegistry();
  registry.register('ApiError', ApiErrorSchema);
  registry.registerComponent('securitySchemes', 'bearerAuth', { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' });
  registry.registerComponent('securitySchemes', 'cookieAuth', { type: 'apiKey', in: 'cookie', name: ACCESS_COOKIE });

  const auth = {
    required: new Set(options.auth.required),
    optional: new Set(options.auth.optional),
    staff: new Set(options.auth.staff),
  };

  for (const [mount, router] of routes) {
    const routerGuards: Layer[] = [];
    for (const layer of (router as unknown as { stack: Layer[] }).stack) {
      if (!layer.route) {
        routerGuards.push(layer);
        continue;
      }
      const fullPath = toOpenApiPath(joinPath(mount, layer.route.path));
      if (options.exclude?.(fullPath)) continue;
      const handlers = [...routerGuards, ...layer.route.stack].map(l => l.handle);
      const schemas = handlers.find(h => h.schemas)?.schemas ?? {};
      const permissions = [...new Set(handlers.flatMap(h => h.permissions ?? []))];
      const role = handlers.find(h => h.role)?.role;
      const requiresAuth = permissions.length > 0 || !!role || handlers.some(h => auth.required.has(h) || auth.staff.has(h));
      const optionalAuth = !requiresAuth && handlers.some(h => auth.optional.has(h));

      const pathParams = [...fullPath.matchAll(/\{([^}]+)\}/g)].map(m => m[1]);
      const declaredParams = asObject(schemas.params);
      const params =
        pathParams.length > 0
          ? z.object(Object.fromEntries(pathParams.map(p => [p, (declaredParams?.shape[p] as ZodTypeAny | undefined) ?? z.string()])))
          : undefined;
      const query = asObject(schemas.query);

      for (const method of METHODS.filter(m => layer.route!.methods[m])) {
        const override = options.overrides?.[`${method.toUpperCase()} ${fullPath}`] ?? {};
        const notes = [
          permissions.length
            ? `Requires permission${permissions.length > 1 ? 's' : ''}: ${permissions.map(p => `\`${p}\``).join(', ')}.`
            : '',
          role ? `Requires the \`${role}\` role.` : '',
          optionalAuth ? 'Authentication is optional; signed-in callers get personalised results.' : '',
          !['get', 'head'].includes(method) && (requiresAuth || optionalAuth)
            ? 'Cookie-authenticated browser calls must send `X-CSRF-Token`.'
            : '',
        ].filter(Boolean);

        const body = override.requestSchema
          ? { content: { [override.requestContentType ?? 'application/json']: { schema: override.requestSchema } } }
          : schemas.body
            ? { content: { 'application/json': { schema: documentable(schemas.body) } } }
            : undefined;

        registry.registerPath({
          method,
          path: fullPath,
          operationId: operationId(method, fullPath),
          tags: [tagFor(mount)],
          summary: override.summary ?? `${method.toUpperCase()} ${fullPath}`,
          description: notes.join(' ') || undefined,
          security: requiresAuth
            ? [{ bearerAuth: [] }, { cookieAuth: [] }]
            : optionalAuth
              ? [{}, { bearerAuth: [] }, { cookieAuth: [] }]
              : [],
          ...(permissions.length && { 'x-permissions': permissions }),
          request: {
            ...(params && { params }),
            ...(query && { query }),
            ...(body && { body }),
          },
          responses: {
            '2XX': {
              description: 'Success',
              content: { [override.responseContentType ?? 'application/json']: { schema: {} } },
            },
            ...Object.fromEntries(
              Object.entries(ERROR_RESPONSES)
                .filter(([status]) => (status === '401' || status === '403' ? requiresAuth || status === '403' : true))
                .map(([status, description]) => [status, { description, content: { 'application/json': { schema: ApiErrorSchema } } }]),
            ),
          },
        });
      }
    }
  }

  const document = new OpenApiGeneratorV31(registry.definitions).generateDocument({
    openapi: '3.1.0',
    info: {
      title: options.title,
      version: options.version,
      description:
        'Generated from the route table and zod request schemas. Amounts are integer paise. Authenticate with a Bearer access token or the session cookie.',
    },
    servers: [{ url: options.serverUrl }],
  });
  return document as unknown as OpenApiDocument;
}
