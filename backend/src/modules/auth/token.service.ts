import { createHash, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { UnauthorizedError } from '../../core/errors';

export interface AccessTokenPayload {
  sub: string;
  email: string;
  type: 'access';
  iat: number;
  /** Millisecond issue time; `iat` only has second precision. */
  iatMs?: number;
}

export interface RefreshTokenPayload {
  sub: string;
  fid: string;
  jti: string;
  type: 'refresh';
}

export interface TokenSecrets {
  access: string;
  refresh: string;
}

export const ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000;
export const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const ALGORITHM = 'HS256' as const;

export class TokenService {
  constructor(private readonly secrets: TokenSecrets) {}

  signAccess(userId: string, email: string): string {
    return jwt.sign({ sub: userId, email, type: 'access', iatMs: Date.now() }, this.secrets.access, {
      algorithm: ALGORITHM,
      expiresIn: ACCESS_TOKEN_TTL_MS / 1000,
    });
  }

  signRefresh(userId: string, familyId: string, expiresAt: Date): string {
    const ttlSeconds = Math.max(1, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
    return jwt.sign({ sub: userId, fid: familyId, jti: randomUUID(), type: 'refresh' }, this.secrets.refresh, {
      algorithm: ALGORITHM,
      expiresIn: ttlSeconds,
    });
  }

  verifyAccess(token: string): AccessTokenPayload {
    let payload: AccessTokenPayload;
    try {
      payload = jwt.verify(token, this.secrets.access, { algorithms: [ALGORITHM] }) as AccessTokenPayload;
    } catch (e) {
      throw new UnauthorizedError((e as Error).name === 'TokenExpiredError' ? 'Token expired' : 'Invalid token');
    }
    if (payload.type !== 'access') throw new UnauthorizedError('Invalid token type');
    return payload;
  }

  verifyRefresh(token: string): RefreshTokenPayload {
    let payload: RefreshTokenPayload;
    try {
      payload = jwt.verify(token, this.secrets.refresh, { algorithms: [ALGORITHM] }) as RefreshTokenPayload;
    } catch {
      throw new UnauthorizedError('Invalid refresh token');
    }
    if (payload.type !== 'refresh' || !payload.fid) throw new UnauthorizedError('Invalid token type');
    return payload;
  }

  static fingerprint(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
