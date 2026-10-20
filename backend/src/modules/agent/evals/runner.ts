import { permissionsFor } from '@storefront/contracts';
import bcrypt from 'bcryptjs';
import type { Container } from '../../../core/container';
import type { AuthUser } from '../../../core/http/types';
import { seedDemoData } from '../../../db/seed/demo-seeder';
import { UserModel } from '../../auth/user.model';
import { CartModel } from '../../cart/cart.model';
import { ProductModel } from '../../catalog/product.model';
import { PendingActionModel } from '../actions/pending-action.model';
import type { GenerateOptions, LLMProvider, LLMRequest, LLMResponse } from '../llm/llm.types';
import type { EvalFixture, Scenario, ScenarioResult } from './eval.types';

/** Decorator that records every request and response so graders can inspect the tool trajectory. */
class RecordingProvider implements LLMProvider {
  readonly requests: LLMRequest[] = [];
  readonly responses: LLMResponse[] = [];

  constructor(private readonly inner: LLMProvider) {}

  get name() {
    return this.inner.name;
  }

  get model() {
    return this.inner.model;
  }

  async generate(request: LLMRequest, options?: GenerateOptions): Promise<LLMResponse> {
    this.requests.push(structuredClone(request));
    const res = await this.inner.generate(request, options);
    this.responses.push(res);
    return res;
  }
}

/** Seeds the demo catalog plus a signed-in customer with one unpaid order. */
export async function prepareFixture(container: Container): Promise<EvalFixture> {
  await seedDemoData({ ADMIN_EMAIL: 'admin@storefront.dev', ADMIN_PASSWORD: undefined });
  const email = 'eval-customer@storefront.dev';
  const doc =
    (await UserModel.findOne({ email })) ??
    (await UserModel.create({ email, name: 'Eval Customer', role: 'customer', passwordHash: await bcrypt.hash('Eval@12345', 4) }));
  const customer: AuthUser = { id: String(doc._id), email, name: doc.name, role: 'customer', permissions: permissionsFor('customer') };
  const product = (await ProductModel.findOne({ 'sizes.stock': { $gt: 2 } })
    .sort({ slug: 1 })
    .lean())!;
  const size = product.sizes.find(s => s.stock > 2)!.size;
  const order = await container.services.orders.create(
    {
      items: [{ productId: String(product._id), size, qty: 1 }],
      codes: [],
      address: { name: 'Eval Customer', line1: '12 Test Street', city: 'Pune', state: 'MH', pincode: '411001', phone: '9876543210' },
    },
    customer,
  );
  return { container, customer, orderNumber: order.orderNumber };
}

export async function runScenario(fx: EvalFixture, scenario: Scenario, provider: LLMProvider): Promise<ScenarioResult> {
  await PendingActionModel.deleteMany({});
  await CartModel.deleteMany({ userId: fx.customer.id });
  await scenario.setup?.(fx);
  const agent = fx.container.services.agent;
  const previous = agent.currentProvider;
  const recorder = new RecordingProvider(provider);
  agent.useProvider(recorder);
  try {
    const cart = (await scenario.cart?.(fx)) ?? [];
    const res = await agent.chat(
      { sessionId: `eval-${scenario.id}-${Date.now()}`, message: scenario.message, context: { cart } },
      scenario.as === 'customer' ? fx.customer : null,
    );
    const toolResults = [...new Set(recorder.requests.flatMap(r => r.messages.filter(m => m.role === 'tool').map(m => m.content)))];
    const transcript = {
      reply: res.reply,
      system: recorder.requests[0]?.system ?? '',
      toolCalls: recorder.responses.flatMap(r => r.toolCalls.map(c => c.name)),
      toolResults,
      actions: res.actions,
    };
    const checks = await Promise.all(scenario.checks.map(check => check(transcript, fx)));
    return { id: scenario.id, description: scenario.description, pass: checks.every(c => c.pass), checks, transcript };
  } catch (err) {
    const transcript = { reply: '', system: '', toolCalls: [], toolResults: [], actions: [] };
    const checks = [{ check: 'completes without error', pass: false, detail: (err as Error).message }];
    return { id: scenario.id, description: scenario.description, pass: false, checks, transcript };
  } finally {
    agent.useProvider(previous);
  }
}

export async function runSuite(
  fx: EvalFixture,
  scenarios: Scenario[],
  providerFor: (s: Scenario) => LLMProvider,
): Promise<ScenarioResult[]> {
  const results: ScenarioResult[] = [];
  for (const scenario of scenarios) results.push(await runScenario(fx, scenario, providerFor(scenario)));
  return results;
}

export function formatScorecard(results: ScenarioResult[], label: string): string {
  const checks = results.flatMap(r => r.checks);
  const lines = [`Agent eval scorecard: ${label}`, ''];
  for (const r of results) {
    lines.push(`${r.pass ? 'PASS' : 'FAIL'}  ${r.id.padEnd(22)} ${r.description}`);
    for (const c of r.checks) lines.push(`        ${c.pass ? '✓' : '✗'} ${c.check}${c.detail && !c.pass ? `  (${c.detail})` : ''}`);
  }
  lines.push(
    '',
    `Scenarios ${results.filter(r => r.pass).length}/${results.length} · checks ${checks.filter(c => c.pass).length}/${checks.length}`,
  );
  return lines.join('\n');
}
