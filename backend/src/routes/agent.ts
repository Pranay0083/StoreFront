import { Router } from 'express';
import { z } from 'zod';
import { optionalAuth, validate } from '../middleware';
import * as agentController from '../controllers/agent.controller';

const router = Router();

const chatSchema = z.object({
  sessionId: z.string({ required_error: 'Session ID is required' }).min(8, 'Session ID must be at least 8 characters').max(80, 'Session ID is too long'),
  message: z.string({ required_error: 'Message is required' }).min(1, 'Message cannot be empty').max(2000, 'Message cannot exceed 2000 characters'),
  context: z.object({
    path: z.string().max(200).optional(),
    cart: z.array(z.object({
      title: z.string(), size: z.string(), qty: z.number(), price: z.number(),
    })).max(30).optional(),
  }).strict().optional(),
}).strict();

router.post('/chat', optionalAuth, validate(chatSchema), agentController.handleChat);
router.get('/history', agentController.getHistory);

export default router;
