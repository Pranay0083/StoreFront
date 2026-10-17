import type { LLMUsage } from './llm.types';

/** USD per million tokens. Groq rates are list-price estimates; override with AGENT_MODEL_PRICING. */
export const DEFAULT_MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'claude-opus-5-5': { input: 4, output: 20 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5 },
  'openai/gpt-oss-120b': { input: 0.15, output: 0.6 },
  'openai/gpt-oss-20b': { input: 0.1, output: 0.5 },
  'llama-3.3-70b-versatile': { input: 0.59, output: 0.79 },
  'scripted-model': { input: 1, output: 2 },
};

export class ModelPricing {
  constructor(private readonly table: Record<string, { input: number; output: number }> = DEFAULT_MODEL_PRICING) {}

  /** Estimated cost in USD; unknown models cost 0 so they show up as gaps rather than wrong numbers. */
  costUsd(model: string, usage: LLMUsage): number {
    const rate = this.table[model];
    if (!rate) return 0;
    return (usage.inputTokens * rate.input + usage.outputTokens * rate.output) / 1_000_000;
  }

  static fromEnv(json: string | undefined): ModelPricing {
    if (!json) return new ModelPricing();
    const overrides = JSON.parse(json) as Record<string, { input: number; output: number }>;
    return new ModelPricing({ ...DEFAULT_MODEL_PRICING, ...overrides });
  }
}
