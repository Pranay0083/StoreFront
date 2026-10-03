import type { Migration } from '../migration';
import { ensureIndexes } from './001-ensure-indexes';
import { amountsToPaise } from './002-amounts-to-paise';
import { authSessions } from './030-auth-sessions';
import { loginThrottle } from './031-login-throttle';

export const migrations: readonly Migration[] = [ensureIndexes, amountsToPaise, authSessions, loginThrottle];
