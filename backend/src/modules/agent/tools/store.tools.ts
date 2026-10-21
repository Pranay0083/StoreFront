import { z } from 'zod';
import { STORE_INFO } from '../store-info';
import { AgentTool, type ToolResult } from './agent-tool';

export class GetStoreInfoTool extends AgentTool<z.ZodObject<Record<string, never>>> {
  readonly name = 'get_store_info';
  readonly title = 'Get store info';
  readonly description =
    'Store policies: shipping fees and timelines, payments, returns/refunds/cancellation, offers and promo codes, size guide.';
  readonly schema = z.object({});

  async execute(): Promise<ToolResult> {
    return { ...STORE_INFO };
  }
}
