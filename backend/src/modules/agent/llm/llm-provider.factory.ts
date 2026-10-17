import type { Env } from '../../../core/config/env';
import { AnthropicProvider } from './anthropic.provider';
import { GroqProvider } from './groq.provider';
import type { LLMProvider } from './llm.types';
import { ResilientLLMProvider } from './resilient.provider';

export type LLMProviderConfig = Pick<Env, 'LLM_PROVIDER' | 'ANTHROPIC_API_KEY' | 'ANTHROPIC_MODEL' | 'GROQ_API_KEY' | 'GROQ_MODEL'>;

export class LLMProviderFactory {
  /** Picks the configured vendor; `auto` prefers Claude when its key is present. Returns null when no key is configured. */
  static create(config: LLMProviderConfig): ResilientLLMProvider | null {
    const provider = LLMProviderFactory.vendor(config);
    return provider ? new ResilientLLMProvider(provider) : null;
  }

  private static vendor(config: LLMProviderConfig): LLMProvider | null {
    const choice = config.LLM_PROVIDER === 'auto' ? (config.ANTHROPIC_API_KEY ? 'anthropic' : 'groq') : config.LLM_PROVIDER;
    if (choice === 'anthropic')
      return config.ANTHROPIC_API_KEY ? new AnthropicProvider(config.ANTHROPIC_API_KEY, config.ANTHROPIC_MODEL) : null;
    return config.GROQ_API_KEY ? new GroqProvider(config.GROQ_API_KEY, config.GROQ_MODEL) : null;
  }
}
