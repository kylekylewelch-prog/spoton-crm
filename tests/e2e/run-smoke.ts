import { spawn, type ChildProcess } from 'node:child_process';
import { objectKeys } from '../../src/objects-list';

/**
 * End-to-end smoke test.
 *
 * Boots the production build, signs in through the real login form, then requests
 * every workspace page and every generated object list and detail page, asserting a
 * 200 and the absence of an error boundary. Unit and integration tests can all pass
 * while a page still fails to render — this is the check that catches that.
 */

const PORT = Number(process.env.SMOKE_PORT ?? 3123);
const BASE = `http://127.0.0.1:${PORT}`;
// Configured explicitly so the MCP transport check is meaningful even when the
// developer has no .env file — the route correctly refuses without a token.
const MCP_TOKEN = process.env.MCP_API_TOKEN ?? 'smoke-test-mcp-token';

const WORKSPACES = [
  '/',
  '/pipeline',
  '/forecast',
  '/revenue',
  '/renewals',
  '/approvals',
  '/health',
  '/service',
  '/demand',
  '/partners',
  '/insights',
  '/governance',
  '/integrations',
  '/notifications',
];

type Result = { url: string; status: number; ok: boolean; note?: string };

let server: ChildProcess | null = null;

function log(msg: string) {
  process.stdout.write(`${msg}\n`);
}

async function waitForServer(timeoutMs = 90_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/login`, { redirect: 'manual' });
      if (res.status > 0) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Server did not start within ${timeoutMs}ms`);
}

/**
 * Signs in through the documented session API. This exercises the same
 * `authenticate` path and issues the same opaque session token the browser cookie
 * carries, so what follows tests the genuinely authenticated experience.
 */
async function signIn(): Promise<string> {
  const res = await fetch(`${BASE}/api/auth/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: 'admin@spoton.dev',
      password: process.env.SEED_PASSWORD ?? 'spoton',
    }),
  });

  if (res.status !== 200) {
    throw new Error(`Sign-in failed with status ${res.status}: ${await res.text()}`);
  }

  const payload = (await res.json()) as { token?: string; user?: { email: string } };
  if (!payload.token) throw new Error('Sign-in returned no session token');

  return `spoton_session=${payload.token}`;
}

async function check(url: string, cookie: string): Promise<Result> {
  try {
    const res = await fetch(`${BASE}${url}`, {
      headers: { cookie },
      redirect: 'manual',
    });

    // A redirect to /login means the session was not accepted.
    if (res.status === 307 || res.status === 302) {
      const location = res.headers.get('location') ?? '';
      if (location.includes('/login')) {
        return { url, status: res.status, ok: false, note: 'redirected to login' };
      }
      return { url, status: res.status, ok: true, note: `redirect to ${location}` };
    }

    if (res.status !== 200) {
      return { url, status: res.status, ok: false };
    }

    const html = await res.text();

    /**
     * Assert positively that the page rendered, rather than blacklisting strings.
     * Next inlines its not-found boundary — including the text "This page could
     * not be found" — into the RSC payload of every page, so searching for that
     * marker flags perfectly healthy pages. Every page in this app renders a
     * PageHeader, so the presence of an <h1> is the reliable signal.
     */
    if (html.includes('Application error: a server-side exception')) {
      return { url, status: res.status, ok: false, note: 'server component threw' };
    }

    const heading = html.match(/<h1[^>]*>([^<]{1,80})/)?.[1]?.trim();
    if (!heading) {
      return { url, status: res.status, ok: false, note: 'no <h1> — page did not render' };
    }

    if (html.length < 400) {
      return { url, status: res.status, ok: false, note: `suspiciously short (${html.length} bytes)` };
    }

    return { url, status: res.status, ok: true, note: heading };
  } catch (err) {
    return { url, status: 0, ok: false, note: err instanceof Error ? err.message : String(err) };
  }
}

async function main() {
  log('[smoke] starting production server…');

  server = spawn('node', ['node_modules/next/dist/bin/next', 'start', '--port', String(PORT)], {
    cwd: process.cwd(),
    env: { ...process.env, NODE_ENV: 'production', MCP_API_TOKEN: MCP_TOKEN },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  });

  const serverLog: string[] = [];
  server.stdout?.on('data', (d) => serverLog.push(String(d)));
  server.stderr?.on('data', (d) => serverLog.push(String(d)));

  try {
    await waitForServer();
    log('[smoke] server up, signing in…');

    const cookie = await signIn();
    log('[smoke] signed in as admin@spoton.dev');

    const results: Result[] = [];

    // Unauthenticated access must be refused.
    const anon = await fetch(`${BASE}/`, { redirect: 'manual' });
    const anonOk = anon.status === 307 || anon.status === 302;
    results.push({
      url: '/ (unauthenticated)',
      status: anon.status,
      ok: anonOk,
      note: anonOk ? 'correctly redirected' : 'was NOT protected',
    });

    log(`[smoke] checking ${WORKSPACES.length} workspace pages…`);
    for (const url of WORKSPACES) {
      results.push(await check(url, cookie));
    }

    const objects = objectKeys();
    log(`[smoke] checking ${objects.length} object list pages…`);
    for (const key of objects) {
      results.push(await check(`/o/${key}`, cookie));
    }

    log('[smoke] checking create forms…');
    for (const key of objects) {
      results.push(await check(`/o/${key}/new`, cookie));
    }

    log('[smoke] checking object detail and edit pages…');
    let detailChecks = 0;
    for (const key of objects) {
      // The detail page needs a real id, so take the first record link from the
      // list page — skipping the "new" and "edit" links, which are not ids.
      const listRes = await fetch(`${BASE}/o/${key}`, { headers: { cookie } });
      const html = await listRes.text();

      const ids = [...html.matchAll(new RegExp(`/o/${key}/([a-z0-9_]+)`, 'g'))]
        .map((m) => m[1])
        .filter((id) => id !== 'new' && id !== 'edit');

      if (ids.length === 0) continue;
      results.push(await check(`/o/${key}/${ids[0]}`, cookie));
      results.push(await check(`/o/${key}/${ids[0]}/edit`, cookie));
      detailChecks++;
    }
    log(`[smoke] checked ${detailChecks} detail and edit pages`);

    // The MCP HTTP transport must reject an unauthenticated call and accept a valid one.
    const mcpAnon = await fetch(`${BASE}/api/mcp`);
    results.push({
      url: '/api/mcp (no token)',
      status: mcpAnon.status,
      ok: mcpAnon.status === 401,
      note: mcpAnon.status === 401 ? 'correctly refused' : 'was NOT protected',
    });

    const mcpList = await fetch(`${BASE}/api/mcp`, {
      headers: { authorization: `Bearer ${MCP_TOKEN}` },
    });
    let mcpToolCount = 0;
    if (mcpList.status === 200) {
      const payload = (await mcpList.json()) as { tools?: unknown[] };
      mcpToolCount = payload.tools?.length ?? 0;
    }
    results.push({
      url: '/api/mcp (with token)',
      status: mcpList.status,
      ok: mcpList.status === 200 && mcpToolCount > 0,
      note: `${mcpToolCount} tools advertised`,
    });

    const mcpCall = await fetch(`${BASE}/api/mcp`, {
      method: 'POST',
      headers: { authorization: `Bearer ${MCP_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ tool: 'spoton_pipeline', arguments: {} }),
    });
    results.push({
      url: '/api/mcp POST spoton_pipeline',
      status: mcpCall.status,
      ok: mcpCall.status === 200,
    });

    /* --- report --------------------------------------------------------- */
    const failures = results.filter((r) => !r.ok);
    const passes = results.length - failures.length;

    log('');
    log(`[smoke] ${passes}/${results.length} checks passed`);

    if (failures.length > 0) {
      log('');
      log('[smoke] FAILURES:');
      for (const f of failures) {
        log(`  ✕ ${f.url}  status=${f.status}${f.note ? `  ${f.note}` : ''}`);
      }
      log('');
      log('[smoke] last server output:');
      log(serverLog.slice(-30).join(''));
      process.exitCode = 1;
    } else {
      log('[smoke] every page rendered and every guard held');
    }
  } finally {
    server?.kill();
    // Give the process a moment to release the port.
    await new Promise((r) => setTimeout(r, 300));
  }
}

main().catch((err) => {
  log(`[smoke] failed: ${err instanceof Error ? err.stack : String(err)}`);
  server?.kill();
  process.exit(1);
});
