import type { GenerateOptions, LLMMessage, LLMProvider, LLMRequest, LLMResponse, LLMToolCall } from './llm.types';

export type ScriptedTurn = { text?: string; toolCalls?: Array<{ name: string; args?: Record<string, unknown> }> };

/** Decides the next model turn from the request, standing in for a real model in tests and evals. */
export type Script = (request: LLMRequest, turn: number) => ScriptedTurn;

let callCounter = 0;

/** Deterministic fake model: replies come from a script, tokens are estimated from text length. */
export class ScriptedLLMProvider implements LLMProvider {
  readonly name = 'scripted';
  readonly requests: LLMRequest[] = [];

  constructor(
    private readonly script: Script,
    readonly model = 'scripted-model',
  ) {}

  async generate(request: LLMRequest, options: GenerateOptions = {}): Promise<LLMResponse> {
    this.requests.push(structuredClone(request));
    const turn = this.script(request, this.requests.length - 1);
    const toolCalls: LLMToolCall[] = (turn.toolCalls ?? []).map(c => ({
      id: `call_${++callCounter}`,
      name: c.name,
      arguments: JSON.stringify(c.args ?? {}),
    }));
    const text = turn.text ?? '';
    if (options.onText && text) for (const word of text.match(/\S+\s*/g) ?? []) options.onText(word);
    const input = request.system.length + request.messages.reduce((n, m) => n + m.content.length, 0);
    return {
      content: text,
      toolCalls,
      stopReason: toolCalls.length ? 'tool_use' : 'end',
      usage: { inputTokens: Math.ceil(input / 4), outputTokens: Math.ceil(text.length / 4) + toolCalls.length * 10 },
      model: this.model,
    };
  }
}

export const lastUserMessage = (request: LLMRequest) => [...request.messages].reverse().find(m => m.role === 'user')?.content ?? '';

export const toolResults = (request: LLMRequest): Extract<LLMMessage, { role: 'tool' }>[] =>
  request.messages.filter((m): m is Extract<LLMMessage, { role: 'tool' }> => m.role === 'tool');

/** Tool results produced since the latest user message, i.e. during the current turn. */
export const currentToolResults = (request: LLMRequest) => {
  const lastUser = request.messages.map(m => m.role).lastIndexOf('user');
  return request.messages.slice(lastUser + 1).filter((m): m is Extract<LLMMessage, { role: 'tool' }> => m.role === 'tool');
};
