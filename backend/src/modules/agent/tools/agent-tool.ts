import type { CartLine } from '@storefront/contracts';
import type { z } from 'zod';
import type { AuthUser } from '../../../core/http/types';
import type { PendingActionView } from '../actions/pending-action.model';

export type ToolChannel = 'widget' | 'mcp';

/** `customer` tools need a signed-in user; `public` tools also work for guests and MCP clients. */
export type ToolAccess = 'public' | 'customer';

export interface ToolContext {
  user: AuthUser | null;
  channel: ToolChannel;
  sessionId?: string;
  /** The shopper's bag: the server cart for signed-in users, the widget's lines for guests. */
  cart: CartLine[];
}

export type ToolResult = Record<string, unknown>;

export type AnyObjectSchema = z.ZodObject<z.ZodRawShape>;

/** Command object: one tool with its schema, access rules and behaviour. */
export abstract class AgentTool<S extends AnyObjectSchema = AnyObjectSchema> {
  abstract readonly name: string;
  abstract readonly title: string;
  abstract readonly description: string;
  abstract readonly schema: S;
  readonly access: ToolAccess = 'public';
  readonly channels: readonly ToolChannel[] = ['widget', 'mcp'];
  /** Write tools never act directly: they propose a pending action the customer must confirm. */
  readonly requiresConfirmation: boolean = false;

  abstract execute(args: z.infer<S>, ctx: ToolContext): Promise<ToolResult>;

  availableIn(ctx: Pick<ToolContext, 'user' | 'channel'>): boolean {
    if (!this.channels.includes(ctx.channel)) return false;
    return this.access === 'public' || ctx.user !== null;
  }
}

export interface ToolExecution {
  ok: boolean;
  result: ToolResult;
  action?: PendingActionView;
}
