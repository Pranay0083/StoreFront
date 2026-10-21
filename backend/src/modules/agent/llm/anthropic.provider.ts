import Anthropic from '@anthropic-ai/sdk';
import type { GenerateOptions, LLMMessage, LLMProvider, LLMRequest, LLMResponse, LLMStopReason } from './llm.types';

type BetaMessageParam = Anthropic.Beta.Messages.BetaMessageParam;
type BetaContentBlock = Anthropic.Beta.Messages.BetaContentBlock;
type BetaContentBlockParam = Anthropic.Beta.Messages.BetaContentBlockParam;
type BetaToolResultBlockParam = Anthropic.Beta.Messages.BetaToolResultBlockParam;

const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

/**
 * Consecutive tool results must travel in a single user turn, and assistant turns produced in
 * this tool loop are replayed with their native content so thinking blocks survive unchanged.
 */
export function toAnthropicMessages(messages: LLMMessage[]): BetaMessageParam[] {
  const out: BetaMessageParam[] = [];
  for (const m of messages) {
    if (m.role === 'user') {
      out.push({ role: 'user', content: m.content });
    } else if (m.role === 'assistant') {
      if (Array.isArray(m.native)) {
        out.push({ role: 'assistant', content: m.native as BetaContentBlockParam[] });
        continue;
      }
      const blocks: BetaContentBlockParam[] = [];
      if (m.content) blocks.push({ type: 'text', text: m.content });
      for (const c of m.toolCalls ?? []) blocks.push({ type: 'tool_use', id: c.id, name: c.name, input: safeJson(c.arguments) });
      out.push({ role: 'assistant', content: blocks.length ? blocks : m.content });
    } else {
      const result: BetaToolResultBlockParam = { type: 'tool_result', tool_use_id: m.toolCallId, content: m.content, is_error: m.isError };
      const last = out[out.length - 1];
      if (last?.role === 'user' && Array.isArray(last.content) && last.content.every(b => b.type === 'tool_result')) {
        last.content.push(result);
      } else {
        out.push({ role: 'user', content: [result] });
      }
    }
  }
  return out;
}

function safeJson(text: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(text || '{}');
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const STOP: Record<string, LLMStopReason> = { tool_use: 'tool_use', max_tokens: 'max_tokens', refusal: 'refusal' };

/** Adapter for the Claude Messages API (streaming, server-side refusal fallback, adaptive thinking). */
export class AnthropicProvider implements LLMProvider {
  readonly name = 'anthropic';
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    readonly model: string,
    client?: Anthropic,
  ) {
    this.client = client ?? new Anthropic({ apiKey, maxRetries: 0 });
  }

  async generate(request: LLMRequest, options: GenerateOptions = {}): Promise<LLMResponse> {
    const stream = this.client.beta.messages.stream(
      {
        model: this.model,
        max_tokens: request.maxTokens,
        system: request.system,
        messages: toAnthropicMessages(request.messages),
        tools: request.tools.map(t => ({
          name: t.name,
          description: t.description,
          input_schema: t.parameters as Anthropic.Beta.Messages.BetaTool.InputSchema,
          eager_input_streaming: true,
        })),
        output_config: { effort: 'low' },
        betas: [FALLBACK_BETA],
        fallbacks: 'default',
      },
      { signal: options.signal },
    );
    if (options.onText) {
      const onText = options.onText;
      stream.on('text', delta => onText(delta));
    }
    const message = await stream.finalMessage();
    const blocks = message.content as BetaContentBlock[];
    const refused = message.stop_reason === 'refusal';
    const toolCalls = refused
      ? []
      : blocks.flatMap(b => (b.type === 'tool_use' ? [{ id: b.id, name: b.name, arguments: JSON.stringify(b.input ?? {}) }] : []));
    const content = refused
      ? ''
      : blocks
          .flatMap(b => (b.type === 'text' ? [b.text] : []))
          .join('')
          .trim();
    return {
      content,
      toolCalls,
      stopReason: STOP[message.stop_reason ?? ''] ?? 'end',
      usage: { inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens },
      model: message.model,
      native: blocks,
    };
  }
}
