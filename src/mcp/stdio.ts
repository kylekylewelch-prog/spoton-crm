import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { zodToJsonSchema } from './json-schema';
import { TOOLS, resolveMcpUser, runTool } from './tools';
import { closeDb } from '@/db';

/**
 * The stdio MCP server, for Claude Desktop and Claude Code.
 *
 * The session runs as a real SpotOn user — by default the integration service
 * account, which has broad read access and deliberately narrow write access.
 * Every write it performs is attributed to that principal in the audit trail with
 * source `mcp`, so nothing Claude does is indistinguishable from a human's work.
 */
async function main() {
  const user = await resolveMcpUser();

  const server = new Server(
    { name: 'spoton-crm', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: zodToJsonSchema(t.inputSchema),
      annotations: {
        title: t.title,
        readOnlyHint: t.readOnly,
      },
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const result = await runTool(request.params.name, request.params.arguments, {
      user,
      audit: { user: { id: user.id }, source: 'mcp' },
    });

    return {
      content: [{ type: 'text' as const, text: result.text }],
      isError: !result.ok,
    };
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Diagnostics go to stderr — stdout is the protocol channel.
  process.stderr.write(
    `[spoton-mcp] ready as ${user.email} (${user.roleName}) with ${TOOLS.length} tools\n`,
  );

  const shutdown = async () => {
    await closeDb();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  process.stderr.write(`[spoton-mcp] failed to start: ${err}\n`);
  process.exit(1);
});
