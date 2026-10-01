import jwt from 'jsonwebtoken';
import { UnauthorizedError } from '../../core/errors';

export type TokenType = 'access' | 'refresh';

export interface TokenPayload {
  sub: string;
  type: TokenType;
  email?: string;
}

export const ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000;
export const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export class TokenService {
  constructor(private readonly secret: string) {}

  signAccess(userId: string, email: string): string {
    return jwt.sign({ sub: userId, email, type: 'access' }, this.secret, { expiresIn: ACCESS_TOKEN_TTL_MS / 1000 });
  }

  signRefresh(userId: string): string {
    return jwt.sign({ sub: userId, type: 'refresh' }, this.secret, { expiresIn: REFRESH_TOKEN_TTL_MS / 1000 });
  }

  verify(token: string, expected: TokenType): TokenPayload {
    let payload: TokenPayload;
    try {
      payload = jwt.verify(token, this.secret) as TokenPayload;
    } catch (e) {
      if (expected === 'refresh') throw new UnauthorizedError('Invalid refresh token');
      throw new UnauthorizedError((e as Error).name === 'TokenExpiredError' ? 'Token expired' : 'Invalid token');
    }
    if (payload.type !== expected) throw new UnauthorizedError('Invalid token type');
    return payload;
  }
}
