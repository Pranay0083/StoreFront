import type { ApiErrorDetail } from '@storefront/contracts';

export class AppError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: ApiErrorDetail[],
    readonly code?: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class BadRequestError extends AppError {
  constructor(message = 'Bad request', details?: ApiErrorDetail[]) {
    super(400, message, details, 'BAD_REQUEST');
  }
}

export class ValidationError extends AppError {
  constructor(details: ApiErrorDetail[]) {
    super(400, 'Validation failed', details, 'VALIDATION_FAILED');
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Not authenticated') {
    super(401, message, undefined, 'UNAUTHORIZED');
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(403, message, undefined, 'FORBIDDEN');
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Not found') {
    super(404, message, undefined, 'NOT_FOUND');
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(409, message, undefined, 'CONFLICT');
  }
}

export class TooManyRequestsError extends AppError {
  constructor(message: string) {
    super(429, message, undefined, 'TOO_MANY_REQUESTS');
  }
}

export class BadGatewayError extends AppError {
  constructor(message: string) {
    super(502, message, undefined, 'BAD_GATEWAY');
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message: string) {
    super(503, message, undefined, 'SERVICE_UNAVAILABLE');
  }
}
