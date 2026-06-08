import { createMcpHandler } from 'mcp-handler';
import { registerAll } from '../../lib/register';
import { SERVER_INFO, INSTRUCTIONS } from '../../lib/meta';

export const dynamic = 'force-dynamic';
// 60s deploys on every Vercel plan (incl. Hobby). Pro/Enterprise can raise this.
export const maxDuration = 60;

/**
 * MCP endpoint for the Streamable HTTP transport, served at /mcp.
 *
 * Stateless: a fresh MCP server is initialised per request, so the handler scales
 * on Vercel without shared session state.
 *
 * Per-user Wiki.js credentials + policy are read inside each tool call (lib/context.ts)
 * from request HEADERS — Authorization / X-Wikijs-Token / X-Wikijs-Url / X-Wikijs-Policy.
 *
 * Some MCP clients (claude.ai web custom connectors, ChatGPT developer mode) do NOT
 * let you set custom headers. For those, the same values may be passed as URL QUERY
 * parameters on the connector URL, e.g.
 *     https://<deploy>/mcp?url=https://wiki.example.org&token=<api-key-or-alias>
 * The wrapper below copies those query params into the equivalent headers (without
 * overriding real headers), so the rest of the server stays header-only.
 */
const mcp = createMcpHandler(
  (server) => {
    registerAll(server);
  },
  {
    serverInfo: SERVER_INFO,
    instructions: INSTRUCTIONS,
  },
  {
    // Routing lives at app/[transport]/route.ts → streamable HTTP endpoint is /mcp.
    basePath: '',
    // SSE needs Redis and is deprecated by the MCP spec; keep only Streamable HTTP.
    disableSse: true,
    maxDuration: 60,
    verboseLogs: process.env.WIKIJS_MCP_VERBOSE === 'true',
  },
);

const QUERY_TO_HEADER: Array<[aliases: string[], header: string, guard: string[]]> = [
  [['token', 'key'], 'x-wikijs-token', ['x-wikijs-token', 'authorization']],
  [['url', 'wiki'], 'x-wikijs-url', ['x-wikijs-url']],
  [['preset'], 'x-wikijs-preset', ['x-wikijs-preset']],
  [['policy'], 'x-wikijs-policy', ['x-wikijs-policy']],
];

async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const params = url.searchParams;
  if (![...QUERY_TO_HEADER].some(([aliases]) => aliases.some((a) => params.has(a)))) {
    return mcp(req); // header-only path — pass through untouched
  }

  const headers = new Headers(req.headers);
  for (const [aliases, header, guards] of QUERY_TO_HEADER) {
    const value = aliases.map((a) => params.get(a)).find((v) => v);
    if (value && !guards.some((g) => headers.has(g))) headers.set(header, value);
  }

  // Rebuild the request with injected headers (Headers are immutable on the original).
  const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.text();
  return mcp(new Request(req.url, { method: req.method, headers, body }));
}

export { handler as GET, handler as POST, handler as DELETE };
