import type { LoginInput, RegisterInput, User } from '@storefront/contracts';
import bcrypt from 'bcryptjs';
import { ConflictError, TooManyRequestsError, UnauthorizedError } from '../../core/errors';
import type { AuthUser } from '../../core/http/types';
import { logger } from '../../core/logger';
import type { LoginAttemptRepository } from './login-attempt.repository';
import type { TokenService } from './token.service';
import type { UserRecord } from './user.model';
import type { UserRepository } from './user.repository';

const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;
const BCRYPT_ROUNDS = 10;

export interface Session {
  user: User;
  accessToken: string;
  refreshToken: string;
}

export const toPublicUser = (u: UserRecord): User => ({ id: String(u._id), email: u.email, name: u.name, role: u.role });

export class AuthService {
  constructor(
    private readonly users: UserRepository,
    private readonly attempts: LoginAttemptRepository,
    private readonly tokens: TokenService,
  ) {}

  async register(input: RegisterInput): Promise<Session> {
    const email = input.email.toLowerCase();
    if (await this.users.existsByEmail(email)) throw new ConflictError('An account with this email already exists');
    const user = await this.users.create({ email, name: input.name, passwordHash: await bcrypt.hash(input.password, BCRYPT_ROUNDS) });
    logger.info({ userId: user._id }, 'New user registered');
    return this.issueSession(user);
  }

  async login(input: LoginInput): Promise<Session> {
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
    return this.issueSession(user);
  }

  async refresh(refreshToken: string | undefined): Promise<Session> {
    if (!refreshToken) throw new UnauthorizedError('No refresh token');
    const payload = this.tokens.verify(refreshToken, 'refresh');
    const user = await this.users.findById(payload.sub);
    if (!user) throw new UnauthorizedError('User not found');
    return this.issueSession(user);
  }

  async authenticate(accessToken: string | undefined): Promise<AuthUser> {
    if (!accessToken) throw new UnauthorizedError('Not authenticated');
    const payload = this.tokens.verify(accessToken, 'access');
    const user = await this.users.findById(payload.sub);
    if (!user) throw new UnauthorizedError('User not found');
    return toPublicUser(user);
  }

  private issueSession(user: UserRecord): Session {
    const id = String(user._id);
    return {
      user: toPublicUser(user),
      accessToken: this.tokens.signAccess(id, user.email),
      refreshToken: this.tokens.signRefresh(id),
    };
  }
}
