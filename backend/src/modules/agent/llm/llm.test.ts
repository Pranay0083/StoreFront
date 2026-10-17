import { describe, expect, it, vi } from 'vitest';
import { toAnthropicMessages } from './anthropic.provider';
import { LLMProviderFactory } from './llm-provider.factory';
import type { LLMProvider, LLMRequest, LLMResponse } from './llm.types';
import { ModelPricing } from './model-pricing';
import { ResilientLLMProvider } from './resilient.provider';

const request: LLMRequest = { system: 's', messages: [{ role: 'user', content: 'hi' }], tools: [], maxTokens: 100 };
const ok: LLMResponse = { content: 'hello', toolCalls: [], stopReason: 'end', usage: { inputTokens: 10, outputTokens: 5 }, model: 'm' };
const http = (status: number) => Object.assign(new Error(`http ${status}`), { status });

function fakeProvider(impl: LLMProvider['generate']): LLMProvider {
  return { name: 'fake', model: 'm', generate: vi.fn(impl) };
}

describe('toAnthropicMessages', () => {
  it('groups consecutive tool results into one user turn and replays native assistant content', () => {
    const native = [
      { type: 'thinking', thinking: '', signature: 'sig' },
      { type: 'tool_use', id: 't1', name: 'a', input: {} },
    ];
    const out = toAnthropicMessages([
      { role: 'user', content: 'find shirts' },
      { role: 'assistant', content: '', toolCalls: [{ id: 't1', name: 'a', arguments: '{}' }], native },
      { role: 'tool', toolCallId: 't1', name: 'a', content: 'r1' },
      { role: 'tool', toolCallId: 't2', name: 'b', content: 'r2', isError: true },
      { role: 'assistant', content: 'done', toolCalls: [{ id: 't3', name: 'c', arguments: '{"x":1}' }] },
    ]);
    expect(out).toHaveLength(4);
    expect(out[1]).toEqual({ role: 'assistant', content: native });
    expect(out[2]).toEqual({
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 't1', content: 'r1', is_error: undefined },
        { type: 'tool_result', tool_use_id: 't2', content: 'r2', is_error: true },
      ],
    });
    expect(out[3]).toEqual({
      role: 'assistant',
      content: [
        { type: 'text', text: 'done' },
        { type: 'tool_use', id: 't3', name: 'c', input: { x: 1 } },
      ],
    });
  });
});

describe('ResilientLLMProvider', () => {
  const noSleep = { sleep: async () => {} };

  it('retries transient failures before anything was streamed', async () => {
    let calls = 0;
    const inner = fakeProvider(async () => {
      if (++calls < 3) throw http(503);
      return ok;
    });
    await expect(new ResilientLLMProvider(inner, noSleep).generate(request)).resolves.toEqual(ok);
    expect(calls).toBe(3);
  });

  it('never retries after tokens reached the caller, or on client errors', async () => {
    const streamed = fakeProvider(async (_r, o) => {
      o?.onText?.('partial');
      throw http(503);
    });
    const onText = vi.fn();
    await expect(new ResilientLLMProvider(streamed, noSleep).generate(request, { onText })).rejects.toThrow('http 503');
    expect(streamed.generate).toHaveBeenCalledTimes(1);
    expect(onText).toHaveBeenCalledWith('partial');

    const bad = fakeProvider(async () => {
      throw http(400);
    });
    await expect(new ResilientLLMProvider(bad, noSleep).generate(request)).rejects.toThrow('http 400');
    expect(bad.generate).toHaveBeenCalledTimes(1);
  });

  it('opens the circuit after repeated outages and fails fast', async () => {
    const down = fakeProvider(async () => {
      throw http(500);
    });
    const provider = new ResilientLLMProvider(down, { ...noSleep, retries: 0 });
    for (let i = 0; i < 5; i++) await expect(provider.generate(request)).rejects.toThrow('http 500');
    expect(provider.breaker.state).toBe('open');
    await expect(provider.generate(request)).rejects.toMatchObject({ code: 'CIRCUIT_OPEN' });
    expect(down.generate).toHaveBeenCalledTimes(5);
  });
});

describe('LLMProviderFactory', () => {
  const base = {
    LLM_PROVIDER: 'auto' as const,
    ANTHROPIC_API_KEY: '',
    ANTHROPIC_MODEL: 'claude-opus-5-5',
    GROQ_API_KEY: '',
    GROQ_MODEL: 'g',
  };

  it('prefers Claude in auto mode, honours an explicit choice and returns null without keys', () => {
    expect(LLMProviderFactory.create(base)).toBeNull();
    expect(LLMProviderFactory.create({ ...base, GROQ_API_KEY: 'k' })?.name).toBe('groq');
    expect(LLMProviderFactory.create({ ...base, GROQ_API_KEY: 'k', ANTHROPIC_API_KEY: 'a' })).toMatchObject({
      name: 'anthropic',
      model: 'claude-opus-5-5',
    });
    expect(LLMProviderFactory.create({ ...base, LLM_PROVIDER: 'groq', GROQ_API_KEY: 'k', ANTHROPIC_API_KEY: 'a' })?.name).toBe('groq');
    expect(LLMProviderFactory.create({ ...base, LLM_PROVIDER: 'anthropic', GROQ_API_KEY: 'k' })).toBeNull();
  });
});

describe('ModelPricing', () => {
  it('prices tokens per million and accepts overrides', () => {
    expect(new ModelPricing().costUsd('claude-opus-5-5', { inputTokens: 1_000_000, outputTokens: 100_000 })).toBeCloseTo(6);
    expect(new ModelPricing().costUsd('unknown', { inputTokens: 5, outputTokens: 5 })).toBe(0);
    expect(
      ModelPricing.fromEnv('{"custom":{"input":1,"output":1}}').costUsd('custom', { inputTokens: 500_000, outputTokens: 500_000 }),
    ).toBeCloseTo(1);
  });
});
