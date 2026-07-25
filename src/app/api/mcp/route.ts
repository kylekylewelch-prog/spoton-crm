import { NextResponse } from 'next/server';
import { TOOLS, resolveMcpUser, runTool } from '@/mcp/tools';
import { zodToJsonSchema } from '@/mcp/json-schema';

export const dynamic = 'force-dynamic';

/**
 * HTTP transport for the MCP tools.
 *
 * A bearer token authenticates the caller, and the session still acts as a real
 * SpotOn user so permissions and audit apply exactly as they do in the browser.
 * This exists alongside the stdio server for hosted deployments where a local
 * process is not an option.
 */

function unauthorised() {
  return NextResponse.json(
    { error: 'Unauthorised. Supply the MCP bearer token in the Authorization header.' },
    { status: 401 },
  );
}

function authorised(request: Request): boolean {
  const expected = process.env.MCP_API_TOKEN;
  // Refuse rather than run open when no token is configured.
  if (!expected) return false;
  const header = request.headers.get('authorization') ?? '';
  return header === `Bearer ${expected}`;
}

export async function GET(request: Request) {
  if (!authorised(request)) return unauthorised();

  return NextResponse.json({
    name: 'spoton-crm',
    version: '1.0.0',
    transport: 'http',
    tools: TOOLS.map((t) => ({
      name: t.name,
      title: t.title,
      description: t.description,
      readOnly: t.readOnly,
      inputSchema: zodToJsonSchema(t.inputSchema),
    })),
  });
}

export async function POST(request: Request) {
  if (!authorised(request)) return unauthorised();

  let body: { tool?: string; name?: string; arguments?: unknown; input?: unknown; userEmail?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body must be JSON' }, { status: 400 });
  }

  const toolName = body.tool ?? body.name;
  if (!toolName) {
    return NextResponse.json(
      { error: 'Supply a tool name as `tool`, with arguments as `arguments`.' },
      { status: 400 },
    );
  }

  let user;
  try {
    user = await resolveMcpUser(body.userEmail);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Could not resolve the MCP user' },
      { status: 500 },
    );
  }

  const result = await runTool(toolName, body.arguments ?? body.input ?? {}, {
    user,
    audit: { user: { id: user.id }, source: 'mcp' },
  });

  return NextResponse.json(
    {
      tool: toolName,
      actingAs: { email: user.email, role: user.roleName },
      isError: !result.ok,
      content: [{ type: 'text', text: result.text }],
    },
    { status: result.ok ? 200 : 422 },
  );
}
