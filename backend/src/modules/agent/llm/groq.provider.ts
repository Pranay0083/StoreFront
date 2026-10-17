import Groq from 'groq-sdk';
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'groq-sdk/resources/chat/completions';
import type { GenerateOptions, LLMMessage, LLMProvider, LLMRequest, LLMResponse, LLMStopReason, LLMToolCall } from './llm.types';

function toGroqMessages(system: string, messages: LLMMessage[]): ChatCompletionMessageParam[] {
  const out: ChatCompletionMessageParam[] = [{ role: 'system', content: system }];
  for (const m of messages) {
    if (m.role === 'user') out.push({ role: 'user', content: m.content });
    else if (m.role === 'tool') out.push({ role: 'tool', tool_call_id: m.toolCallId, content: m.content });
    else
      out.push({
        role: 'assistant',
        content: m.content || null,
        ...(m.toolCalls?.length
          ? {
              tool_calls: m.toolCalls.map(c => ({
                id: c.id,
                type: 'function' as const,
                function: { name: c.name, arguments: c.arguments },
              })),
            }
          : {}),
      } as ChatCompletionMessageParam);
  }
  return out;
}

const stopReason = (finish: string | null | undefined, hasTools: boolean): LLMStopReason =>
  hasTools || finish === 'tool_calls' ? 'tool_use' : finish === 'length' ? 'max_tokens' : 'end';

/** Adapter for Groq's OpenAI-compatible chat completions API. */
export class GroqProvider implements LLMProvider {
  readonly name = 'groq';
  private readonly client: Groq;

  constructor(
    apiKey: string,
    readonly model: string,
    client?: Groq,
  ) {
    this.client = client ?? new Groq({ apiKey, maxRetries: 0 });
  }

  async generate(request: LLMRequest, options: GenerateOptions = {}): Promise<LLMResponse> {
    const body = {
      model: this.model,
      messages: toGroqMessages(request.system, request.messages),
      ...(request.tools.length
        ? {
            tools: request.tools.map((t): ChatCompletionTool => ({
              type: 'function',
              function: { name: t.name, description: t.description, parameters: t.parameters },
            })),
            tool_choice: 'auto' as const,
          }
        : {}),
      temperature: 0.4,
      max_tokens: request.maxTokens,
    };
    if (!options.onText) {
      const completion = await this.client.chat.completions.create(body, { signal: options.signal });
      const msg = completion.choices[0].message;
      const toolCalls = (msg.tool_calls ?? []).map(c => ({ id: c.id, name: c.function.name, arguments: c.function.arguments || '{}' }));
      return {
        content: msg.content ?? '',
        toolCalls,
        stopReason: stopReason(completion.choices[0].finish_reason, toolCalls.length > 0),
        usage: { inputTokens: completion.usage?.prompt_tokens ?? 0, outputTokens: completion.usage?.completion_tokens ?? 0 },
        model: completion.model ?? this.model,
      };
    }

    const stream = await this.client.chat.completions.create({ ...body, stream: true }, { signal: options.signal });
    let content = '';
    let finish: string | null | undefined;
    let usage = { inputTokens: 0, outputTokens: 0 };
    const calls = new Map<number, LLMToolCall>();
    for await (const chunk of stream) {
      const choice = chunk.choices[0];
      const delta = choice?.delta;
      if (delta?.content) {
        content += delta.content;
        options.onText(delta.content);
      }
      for (const tc of delta?.tool_calls ?? []) {
        const call = calls.get(tc.index) ?? { id: '', name: '', arguments: '' };
        if (tc.id) call.id = tc.id;
        if (tc.function?.name) call.name += tc.function.name;
        if (tc.function?.arguments) call.arguments += tc.function.arguments;
        calls.set(tc.index, call);
      }
      if (choice?.finish_reason) finish = choice.finish_reason;
      const u = (chunk as { x_groq?: { usage?: { prompt_tokens?: number; completion_tokens?: number } } }).x_groq?.usage;
      if (u) usage = { inputTokens: u.prompt_tokens ?? 0, outputTokens: u.completion_tokens ?? 0 };
    }
    const toolCalls = [...calls.values()].map((c, i) => ({ ...c, id: c.id || `call_${i}`, arguments: c.arguments || '{}' }));
    return { content, toolCalls, stopReason: stopReason(finish, toolCalls.length > 0), usage, model: this.model };
  }
}
