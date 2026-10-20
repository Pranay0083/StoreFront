import type { Request, Response } from 'express';
import { AppError } from '../../core/errors';
import type { IdParams, Req } from '../../core/http/types';
import { logger } from '../../core/logger';
import type { PendingActionService } from './actions/pending-action.service';
import type { ChatBody } from './agent.schemas';
import type { AgentEvent, AgentService } from './agent.service';
import { LLMAbortedError } from './llm/llm.types';
import type { AgentUsageService } from './usage/agent-usage.service';

export class AgentController {
  constructor(
    private readonly agent: AgentService,
    private readonly actions: PendingActionService,
    private readonly usage: AgentUsageService,
  ) {}

  chat = async (req: Req<ChatBody>, res: Response) => {
    res.json(await this.agent.chat(req.body, req.user ?? null));
  };

  /** Server-Sent Events over POST: `token`, `tool`, `action`, then `done` (or `error`). */
  stream = async (req: Req<ChatBody>, res: Response) => {
    const abort = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) abort.abort();
    });
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    const send = (event: string, data: unknown) => {
      if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    try {
      const result = await this.agent.chat(req.body, req.user ?? null, {
        signal: abort.signal,
        onEvent: (e: AgentEvent) => send(e.type, e),
      });
      send('done', result);
    } catch (err) {
      if (!(err instanceof LLMAbortedError)) {
        if (!(err instanceof AppError)) logger.error({ err }, 'Agent stream failed');
        send('error', {
          error: err instanceof AppError ? err.message : 'Something went wrong, please try again.',
          status: err instanceof AppError ? err.status : 500,
        });
      }
    } finally {
      res.end();
    }
  };

  history = async (req: Req<unknown, { sessionId: string }>, res: Response) => {
    res.json({ messages: await this.agent.history(req.query.sessionId) });
  };

  confirm = async (req: Req<unknown, unknown, IdParams>, res: Response) => {
    res.json({ action: await this.actions.confirm(req.params.id, req.user!) });
  };

  decline = async (req: Req<unknown, unknown, IdParams>, res: Response) => {
    res.json({ action: await this.actions.decline(req.params.id, req.user!) });
  };

  usageSummary = async (req: Request, res: Response) => {
    res.json(await this.usage.summary(Number(req.query.days) || 14));
  };
}
