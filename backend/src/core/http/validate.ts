import type { NextFunction, Request, Response } from 'express';
import type { ZodError, ZodTypeAny } from 'zod';
import { ValidationError } from '../errors';

interface Schemas {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

const toDetails = (error: ZodError, prefix?: string) =>
  error.issues.map(i => ({ path: [prefix, ...i.path].filter(p => p !== undefined).join('.'), message: i.message }));

export const validate =
  (schemas: Schemas) =>
  (req: Request, _res: Response, next: NextFunction): void => {
    const details = [];
    for (const key of ['params', 'query', 'body'] as const) {
      const schema = schemas[key];
      if (!schema) continue;
      const result = schema.safeParse(req[key] ?? {});
      if (!result.success) {
        details.push(...toDetails(result.error, key === 'body' ? undefined : key));
        continue;
      }
      // Express 5 exposes req.query as a getter, so parsed values are installed as own properties.
      Object.defineProperty(req, key, { value: result.data, writable: true, configurable: true, enumerable: true });
    }
    if (details.length) return next(new ValidationError(details));
    next();
  };
