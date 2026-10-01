import type { Response } from 'express';
import type { Req } from '../../core/http/types';
import type { ChatBody } from './agent.schemas';
import type { AgentService } from './agent.service';

export class AgentController {
  constructor(private readonly agent: AgentService) {}

  chat = async (req: Req<ChatBody>, res: Response) => {
    res.json(await this.agent.chat(req.body, req.user ?? null));
  };

  history = async (req: Req<unknown, { sessionId: string }>, res: Response) => {
    res.json({ messages: await this.agent.history(req.query.sessionId) });
  };
}
