import type { CartItem, CartLine } from '@storefront/contracts';
import { AppError, BadGatewayError, ServiceUnavailableError } from '../../core/errors';
import type { AuthUser } from '../../core/http/types';
import { logger } from '../../core/logger';
import type { AgentMetrics } from '../../core/observability/metrics';
import type { CartService } from '../cart/cart.service';
import type { PendingActionView } from './actions/pending-action.model';
import { buildSystemPrompt } from './agent.prompt';
import type { ContextWindow } from './context/context-window';
import type { ConversationDocument, MessageUsage } from './conversation.model';
import type { ConversationRepository } from './conversation.repository';
import { LLMAbortedError, type LLMMessage, type LLMProvider, type LLMResponse, type LLMUsage } from './llm/llm.types';
import type { ModelPricing } from './llm/model-pricing';
import { ToolUsePolicy } from './safety/tool-policy';
import { OutputGuard, wrapToolResult } from './safety/untrusted-content';
import type { ToolContext, ToolRegistry } from './tools';

export interface AgentConfig {
  maxToolTurns: number;
  maxTokens: number;
}

export interface ChatInput {
  sessionId: string;
  message: string;
  context?: { path?: string; cart?: CartLine[] };
}

export type AgentEvent =
  | { type: 'token'; text: string }
  | { type: 'tool'; name: string; title: string; status: 'start' | 'end'; ok?: boolean }
  | { type: 'action'; action: PendingActionView };

export interface ChatResult {
  reply: string;
  sessionId: string;
  actions: PendingActionView[];
  usage: MessageUsage;
}

export interface ChatOptions {
  onEvent?: (event: AgentEvent) => void;
  signal?: AbortSignal;
}

const FALLBACK_REPLY = 'I looked into that but could not finish the request. Could you rephrase?';
const REFUSAL_REPLY = "I can't help with that one, but I'm happy to help you find something in the store.";

/** Runs the tool-calling loop for one customer message, streaming progress through `onEvent`. */
export class AgentService {
  private readonly guard = new OutputGuard();

  constructor(
    private provider: LLMProvider | null,
    private readonly tools: ToolRegistry,
    private readonly conversations: ConversationRepository,
    private readonly cart: CartService,
    private readonly context: ContextWindow,
    private readonly pricing: ModelPricing,
    private readonly config: AgentConfig,
    private readonly metrics?: AgentMetrics,
  ) {}

  /** Swaps the model at runtime, e.g. a scripted provider in tests and evals. */
  useProvider(provider: LLMProvider | null): this {
    this.provider = provider;
    return this;
  }

  get currentProvider(): LLMProvider | null {
    return this.provider;
  }

  async chat(input: ChatInput, user: AuthUser | null, options: ChatOptions = {}): Promise<ChatResult> {
    const provider = this.provider;
    if (!provider) throw new ServiceUnavailableError('AI agent is not configured (set ANTHROPIC_API_KEY or GROQ_API_KEY)');
    try {
      return await this.run(provider, input, user, options);
    } catch (e) {
      if (e instanceof AppError || e instanceof LLMAbortedError) throw e;
      const status = (e as { status?: number }).status;
      logger.error({ err: e, status, provider: provider.name }, 'AI provider request failed');
      if (status === 429) throw new BadGatewayError('The AI agent is rate-limited right now, please try again in a moment.');
      if (status === 401 || status === 403) throw new BadGatewayError('AI agent authentication failed, check the provider API key.');
      throw new BadGatewayError('The AI agent is unavailable right now, please try again.');
    }
  }

  async history(sessionId: string) {
    if (!sessionId) return [];
    const convo = await this.conversations.findBySession(sessionId);
    return (convo?.messages ?? [])
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => ({ role: m.role, content: m.content, at: m.at, ...(m.action ? { action: m.action } : {}) }));
  }

  private async run(provider: LLMProvider, input: ChatInput, user: AuthUser | null, options: ChatOptions): Promise<ChatResult> {
    const started = Date.now();
    const emit = options.onEvent ?? (() => {});
    const convo = await this.conversations.findOrStart(input.sessionId);
    if (user) {
      convo.userId = user.id;
      convo.userEmail = user.email;
      convo.userName = user.name;
    }
    convo.messages.push({ role: 'user', content: input.message, at: new Date() });

    const bag = await this.loadBag(user, input.context?.cart);
    const ctx: ToolContext = {
      user,
      channel: 'widget',
      sessionId: input.sessionId,
      cart: bag.map(i => ({ productId: i.productId, size: i.size, qty: i.qty })),
    };
    const window = await this.context.build(convo);
    const usage: LLMUsage & { costUsd: number; llmCalls: number } = { inputTokens: 0, outputTokens: 0, costUsd: 0, llmCalls: 0 };
    if (window.summarizationUsage) this.addUsage(usage, provider, provider.model, window.summarizationUsage, 0, 'ok');

    const system = buildSystemPrompt(user, { path: input.context?.path, cart: bag, summary: window.summary, canAct: user !== null });
    const messages: LLMMessage[] = [...window.messages];
    const tools = this.tools.definitions(ctx);
    const policy = new ToolUsePolicy(input.message);
    const proposed: PendingActionView[] = [];
    let reply = '';

    try {
      for (let turn = 0; turn < this.config.maxToolTurns; turn++) {
        const res = await this.generate(
          provider,
          { system, messages, tools, maxTokens: this.config.maxTokens },
          usage,
          emit,
          options.signal,
        );
        if (res.stopReason === 'refusal') {
          reply = REFUSAL_REPLY;
          break;
        }
        if (!res.toolCalls.length) {
          reply = res.content.trim();
          break;
        }
        messages.push({ role: 'assistant', content: res.content, toolCalls: res.toolCalls, native: res.native });
        for (const call of res.toolCalls) {
          const tool = this.tools.get(call.name);
          emit({ type: 'tool', name: call.name, title: tool?.title ?? call.name, status: 'start' });
          const decision = policy.check(call.name, tool?.requiresConfirmation ?? false);
          const exec = decision.allowed
            ? await this.tools.execute(call.name, call.arguments, ctx)
            : { ok: false, result: { error: decision.reason }, action: undefined };
          emit({ type: 'tool', name: call.name, title: tool?.title ?? call.name, status: 'end', ok: exec.ok });
          if (exec.action) {
            proposed.push(exec.action);
            emit({ type: 'action', action: exec.action });
          }
          messages.push({
            role: 'tool',
            toolCallId: call.id,
            name: call.name,
            content: wrapToolResult(call.name, exec.result),
            isError: !exec.ok,
          });
          convo.messages.push({
            role: 'tool',
            toolName: call.name,
            content: JSON.stringify({ args: call.arguments, result: exec.result }).slice(0, 3000),
            at: new Date(),
          });
        }
      }
    } catch (err) {
      if (options.signal?.aborted) {
        await this.conversations.save(convo);
        throw new LLMAbortedError();
      }
      throw err;
    }

    reply = this.guard.check(reply || FALLBACK_REPLY, system).reply;
    const action = proposed[proposed.length - 1];
    const messageUsage: MessageUsage = { provider: provider.name, model: provider.model, ...usage, latencyMs: Date.now() - started };
    convo.messages.push({
      role: 'assistant',
      content: reply,
      usage: messageUsage,
      ...(action ? { action: { id: action.id, type: action.type, summary: action.summary, status: action.status } } : {}),
      at: new Date(),
    });
    this.addToTotals(convo, usage);
    await this.conversations.save(convo);
    logger.info(
      { sessionId: input.sessionId, userId: user?.id, llmCalls: usage.llmCalls, costUsd: usage.costUsd },
      'Agent processed chat message',
    );
    return { reply, sessionId: input.sessionId, actions: proposed, usage: messageUsage };
  }

  private async generate(
    provider: LLMProvider,
    request: Parameters<LLMProvider['generate']>[0],
    usage: LLMUsage & { costUsd: number; llmCalls: number },
    emit: (e: AgentEvent) => void,
    signal?: AbortSignal,
  ): Promise<LLMResponse> {
    const started = Date.now();
    try {
      const res = await provider.generate(request, { onText: text => emit({ type: 'token', text }), signal });
      this.addUsage(
        usage,
        provider,
        res.model || provider.model,
        res.usage,
        Date.now() - started,
        res.stopReason === 'refusal' ? 'refusal' : 'ok',
      );
      return res;
    } catch (err) {
      this.metrics?.observeLlmCall({
        provider: provider.name,
        model: provider.model,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        latencyMs: Date.now() - started,
        outcome: 'error',
      });
      throw err;
    }
  }

  private addUsage(
    total: LLMUsage & { costUsd: number; llmCalls: number },
    provider: LLMProvider,
    model: string,
    u: LLMUsage,
    latencyMs: number,
    outcome: 'ok' | 'refusal',
  ) {
    const costUsd = this.pricing.costUsd(model, u);
    total.inputTokens += u.inputTokens;
    total.outputTokens += u.outputTokens;
    total.costUsd += costUsd;
    total.llmCalls += 1;
    this.metrics?.observeLlmCall({
      provider: provider.name,
      model,
      inputTokens: u.inputTokens,
      outputTokens: u.outputTokens,
      costUsd,
      latencyMs,
      outcome,
    });
  }

  private addToTotals(convo: ConversationDocument, u: LLMUsage & { costUsd: number; llmCalls: number }) {
    const t = convo.usage ?? { inputTokens: 0, outputTokens: 0, costUsd: 0, llmCalls: 0 };
    convo.usage = {
      inputTokens: t.inputTokens + u.inputTokens,
      outputTokens: t.outputTokens + u.outputTokens,
      costUsd: t.costUsd + u.costUsd,
      llmCalls: t.llmCalls + u.llmCalls,
    };
  }

  private async loadBag(user: AuthUser | null, lines: CartLine[] = []): Promise<CartItem[]> {
    try {
      return user ? await this.cart.getItems(user.id) : await this.cart.hydrate(lines);
    } catch (err) {
      logger.warn({ err }, 'Could not load the bag for the agent');
      return [];
    }
  }
}
