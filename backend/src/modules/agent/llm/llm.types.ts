/** Provider-neutral chat model contract; adapters translate it to each vendor's wire format. */

export interface LLMToolCall {
  id: string;
  name: string;
  /** Raw JSON text from the model; the tool registry parses and validates it. */
  arguments: string;
}

export type LLMMessage =
  | { role: 'user'; content: string }
  | {
      role: 'assistant';
      content: string;
      toolCalls?: LLMToolCall[];
      /** Vendor-native content to replay verbatim within the same tool loop (e.g. thinking blocks). */
      native?: unknown;
    }
  | { role: 'tool'; toolCallId: string; name: string; content: string; isError?: boolean };

export interface LLMToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface LLMRequest {
  system: string;
  messages: LLMMessage[];
  tools: LLMToolSpec[];
  maxTokens: number;
}

export interface LLMUsage {
  inputTokens: number;
  outputTokens: number;
}

export type LLMStopReason = 'end' | 'tool_use' | 'max_tokens' | 'refusal';

export interface LLMResponse {
  content: string;
  toolCalls: LLMToolCall[];
  stopReason: LLMStopReason;
  usage: LLMUsage;
  model: string;
  native?: unknown;
}

export interface GenerateOptions {
  /** When set the provider streams and reports text deltas as they arrive. */
  onText?: (delta: string) => void;
  signal?: AbortSignal;
}

export interface LLMProvider {
  readonly name: string;
  readonly model: string;
  generate(request: LLMRequest, options?: GenerateOptions): Promise<LLMResponse>;
}

export class LLMAbortedError extends Error {
  constructor() {
    super('The request was cancelled');
  }
}
