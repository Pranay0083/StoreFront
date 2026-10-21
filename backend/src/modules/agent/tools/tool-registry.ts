import { zodToJsonSchema } from 'zod-to-json-schema';
import { AppError } from '../../../core/errors';
import { logger } from '../../../core/logger';
import type { PendingActionView } from '../actions/pending-action.model';
import type { LLMToolSpec } from '../llm/llm.types';
import type { AgentTool, ToolContext, ToolExecution } from './agent-tool';

function parameters(tool: AgentTool): Record<string, unknown> {
  const { $schema: _schema, ...schema } = zodToJsonSchema(tool.schema, { target: 'openApi3', $refStrategy: 'none' }) as Record<
    string,
    unknown
  >;
  return schema;
}

const isPendingAction = (v: unknown): v is PendingActionView =>
  !!v && typeof v === 'object' && typeof (v as PendingActionView).id === 'string' && typeof (v as PendingActionView).type === 'string';

/** Single source of tool definitions for the chat agent and the MCP server. */
export class ToolRegistry {
  private readonly tools = new Map<string, AgentTool>();
  private readonly specs = new Map<string, LLMToolSpec>();

  register(...tools: AgentTool[]): this {
    for (const tool of tools) {
      if (this.tools.has(tool.name)) throw new Error(`Duplicate tool ${tool.name}`);
      this.tools.set(tool.name, tool);
      this.specs.set(tool.name, { name: tool.name, description: tool.description, parameters: parameters(tool) });
    }
    return this;
  }

  get(name: string): AgentTool | undefined {
    return this.tools.get(name);
  }

  available(ctx: Pick<ToolContext, 'user' | 'channel'>): AgentTool[] {
    return [...this.tools.values()].filter(t => t.availableIn(ctx));
  }

  definitions(ctx: Pick<ToolContext, 'user' | 'channel'>): LLMToolSpec[] {
    return this.available(ctx).map(t => this.specs.get(t.name)!);
  }

  /** Parses and validates raw model arguments, enforces access, and never throws. */
  async execute(name: string, rawArgs: unknown, ctx: ToolContext): Promise<ToolExecution> {
    const tool = this.tools.get(name);
    if (!tool || !tool.availableIn(ctx)) {
      return { ok: false, result: { error: tool ? `${name} needs the customer to be signed in` : `Unknown tool ${name}` } };
    }
    let input: unknown = rawArgs;
    if (typeof rawArgs === 'string') {
      try {
        input = JSON.parse(rawArgs || '{}');
      } catch {
        return { ok: false, result: { error: 'Tool arguments were not valid JSON' } };
      }
    }
    const parsed = tool.schema.safeParse(input ?? {});
    if (!parsed.success) {
      return {
        ok: false,
        result: { error: 'Invalid arguments', issues: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`) },
      };
    }
    try {
      const result = await tool.execute(parsed.data, ctx);
      if (typeof result.error === 'string') return { ok: false, result };
      const action = isPendingAction(result.pendingAction) ? result.pendingAction : undefined;
      return { ok: true, result, action };
    } catch (err) {
      if (!(err instanceof AppError)) logger.error({ err, tool: name }, 'Agent tool failed');
      return { ok: false, result: { error: err instanceof AppError ? err.message : 'The tool failed unexpectedly' } };
    }
  }
}
