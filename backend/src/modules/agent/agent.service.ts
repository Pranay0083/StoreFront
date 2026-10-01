import Groq from 'groq-sdk';
import type { ChatCompletionMessageParam } from 'groq-sdk/resources/chat/completions';
import { BadGatewayError, ServiceUnavailableError } from '../../core/errors';
import type { AuthUser } from '../../core/http/types';
import { logger } from '../../core/logger';
import { buildSystemPrompt, type ChatContext } from './agent.prompt';
import type { AgentTools, ToolArgs } from './agent.tools';
import type { ConversationRepository } from './conversation.repository';

export interface AgentConfig {
  apiKey: string;
  model: string;
}

export interface ChatInput {
  sessionId: string;
  message: string;
  context?: ChatContext;
}

const MAX_TOOL_TURNS = 6;
const HISTORY_WINDOW = 20;
const RATE_LIMIT_BACKOFF_MS = 2500;

export class AgentService {
  private client?: Groq;

  constructor(
    private readonly config: AgentConfig,
    private readonly tools: AgentTools,
    private readonly conversations: ConversationRepository,
  ) {}

  async chat({ sessionId, message, context }: ChatInput, user: AuthUser | null): Promise<{ reply: string; sessionId: string }> {
    if (!this.config.apiKey) throw new ServiceUnavailableError('AI agent is not configured (missing GROQ_API_KEY)');
    try {
      return await this.runChat({ sessionId, message, context }, user);
    } catch (e) {
      const status = (e as { status?: number }).status;
      logger.error({ err: e, status }, 'Error connecting to groq API');
      if (status === 429) throw new BadGatewayError('The AI agent is rate-limited right now — please try again in a moment.');
      if (status === 401) throw new BadGatewayError('AI agent authentication failed — check the Groq API key.');
      throw e;
    }
  }

  async history(sessionId: string) {
    if (!sessionId) return [];
    const convo = await this.conversations.findBySession(sessionId);
    return (convo?.messages ?? [])
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => ({ role: m.role, content: m.content, at: m.at }));
  }

  private async runChat({ sessionId, message, context }: ChatInput, user: AuthUser | null) {
    const convo = await this.conversations.findOrStart(sessionId);
    if (user) {
      convo.userId = user.id;
      convo.userEmail = user.email;
      convo.userName = user.name;
    }
    convo.messages.push({ role: 'user', content: message, at: new Date() });

    const history = convo.messages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .slice(-HISTORY_WINDOW)
      .map(m => ({ role: m.role, content: m.content }) as ChatCompletionMessageParam);
    const llmMessages: ChatCompletionMessageParam[] = [{ role: 'system', content: buildSystemPrompt(user, context) }, ...history];

    const ctx = { userId: user?.id, userEmail: user?.email };
    let reply = '';
    for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
      const completion = await this.complete(llmMessages);
      const msg = completion.choices[0].message;

      if (msg.tool_calls?.length) {
        llmMessages.push(msg as ChatCompletionMessageParam);
        for (const tc of msg.tool_calls) {
          const name = tc.function.name;
          let args: ToolArgs = {};
          try {
            args = JSON.parse(tc.function.arguments || '{}') as ToolArgs;
          } catch {
            args = {};
          }
          let result: unknown;
          try {
            result = await this.tools.execute(name, args, ctx);
          } catch (e) {
            result = { error: (e as Error).message };
          }
          llmMessages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result) });
          convo.messages.push({ role: 'tool', toolName: name, content: JSON.stringify({ args, result }).slice(0, 3000), at: new Date() });
        }
        continue;
      }

      reply = msg.content || 'Sorry, I could not come up with a response. Please try again.';
      break;
    }

    if (!reply) reply = 'I looked into that but could not finish the request. Could you rephrase?';
    convo.messages.push({ role: 'assistant', content: reply, at: new Date() });
    await this.conversations.save(convo);
    logger.info({ sessionId, userId: user?.id }, 'Agent processed chat message');
    return { reply, sessionId };
  }

  private async complete(messages: ChatCompletionMessageParam[]) {
    const request = () =>
      this.groq().chat.completions.create({
        model: this.config.model,
        messages,
        tools: this.tools.definitions,
        tool_choice: 'auto',
        temperature: 0.4,
        max_tokens: 1024,
      });
    try {
      return await request();
    } catch (e) {
      if ((e as { status?: number }).status !== 429) throw e;
      await new Promise(r => setTimeout(r, RATE_LIMIT_BACKOFF_MS));
      return request();
    }
  }

  private groq(): Groq {
    this.client ??= new Groq({ apiKey: this.config.apiKey });
    return this.client;
  }
}
