import { WikiClient } from './wikijs/client';
import { Policy, basePolicyFromEnv, parsePolicyConfig, type PolicyConfig } from './permissions';

/**
 * Per-request execution context: which Wiki.js instance + key to talk to, and the
 * effective permission policy (deployment baseline tightened by any request overlay).
 */
export interface WikiContext {
  client: WikiClient;
  policy: Policy;
  baseUrl: string;
  hasToken: boolean;
}

// The deployment baseline is parsed once. Per-request overlays are layered on top.
const BASE_POLICY = basePolicyFromEnv();

export function basePolicy(): Policy {
  return BASE_POLICY;
}

/** Shape of `extra` passed to MCP tool handlers (only the bits we use). */
export interface ToolExtra {
  requestInfo?: { headers?: Record<string, string | string[] | undefined> };
  authInfo?: { token?: string; extra?: Record<string, unknown> };
}

function header(
  headers: Record<string, string | string[] | undefined> | undefined,
  name: string,
): string | undefined {
  if (!headers) return undefined;
  const v = headers[name] ?? headers[name.toLowerCase()];
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === 'string' && s.length > 0 ? s : undefined;
}

/** Resolve an opaque client alias to a real token via the optional WIKIJS_KEY_MAP. */
function resolveAlias(token: string | undefined, env: NodeJS.ProcessEnv): string | undefined {
  if (!token || !env.WIKIJS_KEY_MAP) return token;
  try {
    const map = JSON.parse(env.WIKIJS_KEY_MAP) as Record<string, string>;
    if (map && typeof map === 'object' && typeof map[token] === 'string') return map[token];
  } catch {
    /* ignore malformed map */
  }
  return token;
}

/**
 * Build the context for a tool invocation. On the HTTP transport, credentials and
 * policy overlay come from request headers; on stdio (no headers) they come from env.
 */
export function resolveContext(extra?: ToolExtra): WikiContext {
  const env = process.env;
  const headers = extra?.requestInfo?.headers;

  // --- token: X-Wikijs-Token > Authorization Bearer > authInfo > env ---
  let token = header(headers, 'x-wikijs-token');
  if (!token) {
    const auth = header(headers, 'authorization');
    if (auth && /^bearer\s+/i.test(auth)) token = auth.replace(/^bearer\s+/i, '').trim();
  }
  if (!token && typeof extra?.authInfo?.token === 'string') token = extra.authInfo.token;
  if (!token) token = env.WIKIJS_TOKEN || env.WIKIJS_API_KEY || undefined;
  token = resolveAlias(token, env);

  // --- base URL: X-Wikijs-Url > authInfo.extra.baseUrl > env ---
  let baseUrl =
    header(headers, 'x-wikijs-url') ||
    (typeof extra?.authInfo?.extra?.baseUrl === 'string'
      ? (extra.authInfo.extra.baseUrl as string)
      : undefined) ||
    env.WIKIJS_URL ||
    env.WIKIJS_BASE_URL ||
    '';
  baseUrl = baseUrl.trim();

  if (!baseUrl) {
    throw new Error(
      'No Wiki.js URL configured. Send the "X-Wikijs-Url" header, or set the WIKIJS_URL env var.',
    );
  }

  // --- policy overlay: X-Wikijs-Policy (JSON) and/or X-Wikijs-Preset ---
  let overlay: PolicyConfig | undefined = parsePolicyConfig(header(headers, 'x-wikijs-policy'));
  const preset = header(headers, 'x-wikijs-preset');
  if (preset) overlay = { preset, ...(overlay ?? {}) };

  return {
    client: new WikiClient(baseUrl, token),
    policy: BASE_POLICY.withOverlay(overlay),
    baseUrl,
    hasToken: Boolean(token),
  };
}
