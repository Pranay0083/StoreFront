import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolRegistry } from '../agent/tools';
import type { ToolContext } from '../agent/tools/agent-tool';
import { neutralizeDeep } from '../agent/safety/untrusted-content';

const MCP_CONTEXT: ToolContext = { user: null, channel: 'mcp', cart: [] };

/** Builds a stateless MCP server exposing every tool the registry offers anonymous MCP clients. */
export function buildMcpServer(registry: ToolRegistry): McpServer {
  const server = new McpServer({ name: 'storefront-mcp', version: '2.0.0' });
  for (const tool of registry.available(MCP_CONTEXT)) {
    server.registerTool(tool.name, { title: tool.title, description: tool.description, inputSchema: tool.schema.shape }, async args => {
      const exec = await registry.execute(tool.name, args, MCP_CONTEXT);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(neutralizeDeep(exec.result).value, null, 2) }],
        ...(exec.ok ? {} : { isError: true }),
      };
    });
  }
  return server;
}
