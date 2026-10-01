import type { RequestHandler, Response } from 'express';

/**
 * Adapts a controller method whose request type is narrowed by earlier middleware
 * (`validate()` for body/query/params, auth guards for `req.user`) to Express' handler type.
 */
export const handler = <R>(fn: (req: R, res: Response) => unknown): RequestHandler =>
  fn as unknown as RequestHandler;
