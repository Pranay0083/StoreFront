import type { ActionType } from '../actions/pending-action.model';

/** Words the customer must use in their own message before the agent may propose that action. */
const INTENT: Record<ActionType, RegExp> = {
  add_to_cart: /\b(add|put|bag|cart|basket|buy|purchase|order (it|this|that|one)|i'?ll take|get me)\b/i,
  cancel_order: /\bcancel/i,
  request_refund: /\b(refund|return|money back|send (it )?back)\b/i,
};

export interface PolicyDecision {
  allowed: boolean;
  reason?: string;
}

/**
 * Deterministic guard around model tool calls: caps tool use per turn and only lets a write
 * tool through when the customer's own latest message asked for that kind of change. Text
 * from tool results (e.g. a review saying "cancel my order") can never satisfy it.
 */
export class ToolUsePolicy {
  private calls = 0;
  private proposals = 0;

  constructor(
    private readonly userMessage: string,
    private readonly limits = { maxCallsPerTurn: 8, maxProposalsPerTurn: 1 },
  ) {}

  check(toolName: string, requiresConfirmation: boolean): PolicyDecision {
    if (++this.calls > this.limits.maxCallsPerTurn)
      return { allowed: false, reason: 'Tool call limit reached for this message. Answer with what you have.' };
    if (!requiresConfirmation) return { allowed: true };
    const intent = INTENT[toolName as ActionType];
    if (!intent || !intent.test(this.userMessage)) {
      return {
        allowed: false,
        reason: `Not allowed: the customer did not ask for ${toolName.replace(/_/g, ' ')} in their message. Ask them first.`,
      };
    }
    if (++this.proposals > this.limits.maxProposalsPerTurn)
      return { allowed: false, reason: 'Only one change can be proposed per message.' };
    return { allowed: true };
  }
}
