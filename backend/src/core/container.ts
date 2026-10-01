import type { Router } from 'express';
import { AuthController } from '../modules/auth/auth.controller';
import { AuthGuards } from '../modules/auth/auth.guards';
import { authRoutes } from '../modules/auth/auth.routes';
import { AuthService } from '../modules/auth/auth.service';
import { LoginAttemptRepository } from '../modules/auth/login-attempt.repository';
import { TokenService } from '../modules/auth/token.service';
import { UserRepository } from '../modules/auth/user.repository';
import type { Env } from './config/env';
import { createRateLimiters } from './http/rate-limit';

/** Composition root: the only place where concrete classes are instantiated and wired together. */
export function buildContainer(env: Env) {
  const limiters = createRateLimiters(env);

  const repositories = {
    users: new UserRepository(),
    loginAttempts: new LoginAttemptRepository(),
  };

  const tokens = new TokenService(env.JWT_SECRET);
  const services = {
    tokens,
    auth: new AuthService(repositories.users, repositories.loginAttempts, tokens),
  };

  const guards = new AuthGuards(services.auth);

  const controllers = {
    auth: new AuthController(services.auth),
  };

  const routes: Array<[path: string, router: Router]> = [['/auth', authRoutes(controllers.auth, guards, limiters)]];

  return { env, limiters, repositories, services, guards, controllers, routes };
}

export type Container = ReturnType<typeof buildContainer>;
