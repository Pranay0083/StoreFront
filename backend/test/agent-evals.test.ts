import { beforeEach, describe, expect, it } from 'vitest';
import type { EvalFixture } from '../src/modules/agent/evals/eval.types';
import { formatScorecard, prepareFixture, runScenario, runSuite } from '../src/modules/agent/evals/runner';
import { SCENARIOS } from '../src/modules/agent/evals/scenarios';
import { ScriptedLLMProvider } from '../src/modules/agent/llm/scripted.provider';
import { useTestApp } from './helpers/app';

const t = useTestApp();
let fx: EvalFixture;

beforeEach(async () => {
  fx = await prepareFixture(t.container);
});

const scenario = (id: string) => SCENARIOS.find(s => s.id === id)!;

describe('agent eval suite (scripted reference models)', () => {
  it('passes every scenario and check', async () => {
    const results = await runSuite(fx, SCENARIOS, s => new ScriptedLLMProvider(s.reference));
    const failures = results.flatMap(r => r.checks.filter(c => !c.pass).map(c => `${r.id}: ${c.check} ${c.detail ?? ''}`));
    expect(failures).toEqual([]);
    expect(formatScorecard(results, 'scripted')).toMatch(/Scenarios 6\/6/);
  });

  it('graders catch invented prices and made-up product links', async () => {
    const liar = new ScriptedLLMProvider((_req, turn) =>
      turn === 0
        ? { toolCalls: [{ name: 'search_products', args: { category: 'Footwear' } }] }
        : { text: 'Try [Moon Boots](/products/moon-boots) for ₹1.' },
    );
    const result = await runScenario(fx, scenario('discovery'), liar);
    expect(result.pass).toBe(false);
    expect(result.checks.filter(c => !c.pass).map(c => c.check)).toEqual([
      'product links use [Title](/products/slug) with real slugs',
      'no invented prices',
    ]);
  });

  it('graders catch a model that skips the tool it needed', async () => {
    const lazy = new ScriptedLLMProvider(() => ({ text: 'Done, it is in your bag!' }));
    const result = await runScenario(fx, scenario('add-to-bag'), lazy);
    expect(result.checks).toEqual([
      expect.objectContaining({ check: 'calls add_to_cart', pass: false }),
      expect.objectContaining({ check: 'add_to_cart waits for confirmation', pass: false, detail: 'no pending action proposed' }),
    ]);
  });
});
