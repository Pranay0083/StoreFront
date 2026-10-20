import type { CartLine } from '@storefront/contracts';
import type { Container } from '../../../core/container';
import type { AuthUser } from '../../../core/http/types';
import type { PendingActionView } from '../actions/pending-action.model';
import type { Script } from '../llm/scripted.provider';

export interface EvalFixture {
  container: Container;
  customer: AuthUser;
  orderNumber: string;
}

export interface Transcript {
  reply: string;
  system: string;
  toolCalls: string[];
  toolResults: string[];
  actions: PendingActionView[];
}

export interface CheckResult {
  check: string;
  pass: boolean;
  detail?: string;
}

export type Check = (t: Transcript, fx: EvalFixture) => Promise<CheckResult>;

export interface Scenario {
  id: string;
  description: string;
  as: 'guest' | 'customer';
  message: string;
  cart?: (fx: EvalFixture) => Promise<CartLine[]>;
  setup?: (fx: EvalFixture) => Promise<void>;
  /** A model that behaves as intended, used by the deterministic suite (and as documentation). */
  reference: Script;
  checks: Check[];
}

export interface ScenarioResult {
  id: string;
  description: string;
  pass: boolean;
  checks: CheckResult[];
  transcript: Transcript;
}
