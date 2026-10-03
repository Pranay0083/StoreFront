import type { AuthSessionInfo, LoginInput, RegisterInput, User } from '@storefront/contracts';
import bcrypt from 'bcryptjs';
import { Types } from 'mongoose';
import { ConflictError, NotFoundError, TooManyRequestsError, UnauthorizedError } from '../../core/errors';
import type { AuthUser } from '../../core/http/types';
import { logger } from '../../core/logger';
import type { LoginAttemptRepository } from './login-attempt.repository';
import type { AuthSessionRepository } from './session.repository';
import { REFRESH_TOKEN_TTL_MS, TokenService } from './token.service';
import type { UserRecord } from './user.model';
import type { UserRepository } from './user.repository';

const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;
const BCRYPT_ROUNDS = 10;
/** Absolute lifetime of a login, however often its refresh token is rotated. */
export const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
/** A just-rotated token replayed within this window is a benign race between tabs, not theft. */
export const ROTATION_GRACE_MS = 10_000;

export interface ClientMeta {
  ip?: string;
  userAgent?: string;
}

export interface Session {
  user: User;
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
  sessionId: string;
}

export const toPublicUser = (u: UserRecord): User => ({ id: String(u._id), email: u.email, name: u.name, role: u.role });

export class AuthService {
  constructor(
    private readonly users: UserRepository,
    private readonly attempts: LoginAttemptRepository,
    private readonly sessions: AuthSessionRepository,
    private readonly tokens: TokenService,
  ) {}

  async register(input: RegisterInput, meta: ClientMeta = {}): Promise<Session> {
    const email = input.email.toLowerCase();
    if (await this.users.existsByEmail(email)) throw new ConflictError('An account with this email already exists');
    const user = await this.users.create({ email, name: input.name, passwordHash: await bcrypt.hash(input.password, BCRYPT_ROUNDS) });
    logger.info({ userId: user._id }, 'New user registered');
    return this.startSession(user, meta);
  }

  async login(input: LoginInput, meta: ClientMeta = {}): Promise<Session> {
    const email = input.email.toLowerCase();
    const attempt = await this.attempts.find(email);
    if (attempt?.lockedUntil && attempt.lockedUntil > new Date()) {
      logger.warn({ email }, 'Login rate limited');
      throw new TooManyRequestsError('Too many failed attempts. Try again in 15 minutes.');
    }
    const user = await this.users.findByEmail(email);
    const ok = user !== null && (await bcrypt.compare(input.password, user.passwordHash));
    if (!ok) {
      const count = (attempt?.count ?? 0) + 1;
      const locked = count >= MAX_FAILED_LOGINS;
      await this.attempts.recordFailure(email, count, locked ? new Date(Date.now() + LOCKOUT_MS) : undefined);
      if (locked) logger.warn({ email }, 'Account temporarily locked due to failed logins');
      throw new UnauthorizedError('Invalid email or password');
    }
    await this.attempts.clear(email);
    logger.info({ userId: user._id }, 'User logged in');
    return this.startSession(user, meta);
  }

  /**
   * Rotates the refresh token. Presenting a token that was already rotated away means it leaked
   * (or was replayed), so the whole family is revoked and every holder must sign in again.
   */
  async refresh(refreshToken: string | undefined, meta: ClientMeta = {}): Promise<Session> {
    if (!refreshToken) throw new UnauthorizedError('No refresh token');
    const payload = this.tokens.verifyRefresh(refreshToken);
    const presented = TokenService.fingerprint(refreshToken);
    const user = await this.users.findById(payload.sub);
    if (!user) throw new UnauthorizedError('User not found');

    const family = await this.sessions.findById(payload.fid);
    if (!family || String(family.userId) !== payload.sub) throw new UnauthorizedError('Session not found');
    if (family.revokedAt) throw new UnauthorizedError('Session has been revoked');

    const now = new Date();
    const expiresAt = new Date(Math.min(now.getTime() + REFRESH_TOKEN_TTL_MS, family.expiresAt.getTime()));
    const next = this.tokens.signRefresh(payload.sub, payload.fid, expiresAt);
    const rotated = await this.sessions.rotate(payload.fid, presented, TokenService.fingerprint(next), now);
    if (!rotated) {
      const fresh = await this.sessions.findById(payload.fid);
      const recentlyRotated =
        fresh?.previousHash === presented && fresh.rotatedAt && now.getTime() - fresh.rotatedAt.getTime() < ROTATION_GRACE_MS;
      if (fresh && !fresh.revokedAt && recentlyRotated) throw new UnauthorizedError('Refresh token already rotated');
      if (fresh && !fresh.revokedAt && fresh.expiresAt > now) {
        await this.sessions.revoke(payload.fid, 'reuse_detected');
        logger.warn({ userId: payload.sub, sessionId: payload.fid, ip: meta.ip }, 'Refresh token reuse detected; session family revoked');
      }
      throw new UnauthorizedError('Invalid refresh token');
    }
    return {
      user: toPublicUser(user),
      accessToken: this.tokens.signAccess(payload.sub, user.email),
      refreshToken: next,
      refreshExpiresAt: expiresAt,
      sessionId: payload.fid,
    };
  }

  async logout(refreshToken: string | undefined): Promise<void> {
    const sessionId = this.sessionIdOf(refreshToken);
    if (sessionId) await this.sessions.revoke(sessionId, 'logout');
  }

  async logoutAll(userId: string): Promise<number> {
    const revoked = await this.sessions.revokeAllForUser(userId, 'logout_all');
    await this.users.invalidateSessionsBefore(userId, new Date());
    logger.info({ userId, revoked }, 'User signed out of all sessions');
    return revoked;
  }

  async listSessions(userId: string, refreshToken: string | undefined): Promise<AuthSessionInfo[]> {
    const currentId = this.sessionIdOf(refreshToken);
    const sessions = await this.sessions.listActive(userId);
    return sessions.map(s => ({
      id: String(s._id),
      createdAt: s.createdAt.toISOString(),
      lastUsedAt: s.lastUsedAt.toISOString(),
      ...(s.ip && { ip: s.ip }),
      ...(s.userAgent && { userAgent: s.userAgent }),
      current: String(s._id) === currentId,
    }));
  }

  async revokeSession(userId: string, sessionId: string): Promise<void> {
    if (!(await this.sessions.revoke(sessionId, 'user_revoked', userId))) throw new NotFoundError('Session not found');
  }

  async authenticate(accessToken: string | undefined): Promise<AuthUser> {
    if (!accessToken) throw new UnauthorizedError('Not authenticated');
    const payload = this.tokens.verifyAccess(accessToken);
    const user = await this.users.findById(payload.sub);
    if (!user) throw new UnauthorizedError('User not found');
    const issuedAt = payload.iatMs ?? payload.iat * 1000;
    if (user.sessionsValidAfter && issuedAt < user.sessionsValidAfter.getTime()) {
      throw new UnauthorizedError('Session has been revoked');
    }
    return toPublicUser(user);
  }

  /** Reads the family id from a refresh token without trusting anything else in it. */
  private sessionIdOf(refreshToken: string | undefined): string | undefined {
    if (!refreshToken) return undefined;
    try {
      return this.tokens.verifyRefresh(refreshToken).fid;
    } catch {
      return undefined;
    }
  }

  private async startSession(user: UserRecord, meta: ClientMeta): Promise<Session> {
    const id = String(user._id);
    const sessionId = new Types.ObjectId();
    const now = Date.now();
    const refreshExpiresAt = new Date(now + REFRESH_TOKEN_TTL_MS);
    const refreshToken = this.tokens.signRefresh(id, String(sessionId), refreshExpiresAt);
    await this.sessions.create({
      _id: sessionId,
      userId: id,
      currentHash: TokenService.fingerprint(refreshToken),
      expiresAt: new Date(now + SESSION_MAX_AGE_MS),
      ip: meta.ip,
      userAgent: meta.userAgent?.slice(0, 300),
    });
    return {
      user: toPublicUser(user),
      accessToken: this.tokens.signAccess(id, user.email),
      refreshToken,
      refreshExpiresAt,
      sessionId: String(sessionId),
    };
  }
}
