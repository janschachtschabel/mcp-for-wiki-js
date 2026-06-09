import { WikiClient } from './wikijs/client';
import { Policy, basePolicyFromEnv, parsePolicyConfig, type PolicyConfig } from './permissions';

/**
 * Per-request execution context: which Wiki.js instance + key to talk to, and the
 * effective permission policy (deployment baseline tightened by any overlay).
 */
export interface WikiContext {
  client: WikiClient;
  policy: Policy;
  baseUrl: string;
  hasToken: boolean;
  /** Name of the matched credential profile, if a WIKIJS_PROFILES alias was used. */
  profile?: string;
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

/**
 * A named credential profile (entry of the WIKIJS_PROFILES env map):
 * the real Wiki.js key + instance + optional per-handle policy. The CLIENT only ever
 * sends the alias (the map key) — the real token never leaves the server.
 */
interface Profile {
  /** Non-secret human label for audit/logs (the map KEY is the secret handle token). */
  label?: string;
  url?: string;
  token: string;
  preset?: string;
  policy?: { categories?: unknown; tools?: unknown };
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

/** Look up a named profile by alias in WIKIJS_PROFILES (JSON: { "<alias>": { url, token, preset, policy } }). */
function resolveProfile(alias: string | undefined, env: Record<string, string | undefined>): Profile | undefined {
  if (!alias || !env.WIKIJS_PROFILES) return undefined;
  try {
    const map = JSON.parse(env.WIKIJS_PROFILES) as Record<string, Profile>;
    const p = map?.[alias];
    if (p && typeof p === 'object' && typeof p.token === 'string') return p;
  } catch {
    /* ignore malformed map */
  }
  return undefined;
}

/** Fallback simple alias→token map (token only; url/policy come from env). Kept for backward compat. */
function resolveAlias(token: string | undefined, env: Record<string, string | undefined>): string | undefined {
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
 * Build the context for a tool invocation.
 *
 * Credential resolution order for the incoming "token" (which may be an alias):
 *   1. WIKIJS_PROFILES[alias]  → authoritative {url, token, preset} (real key stays server-side)
 *   2. WIKIJS_KEY_MAP[alias]   → real token (url/policy from env/headers)
 *   3. used verbatim as a raw Wiki.js key (direct BYOK)
 */
export function resolveContext(extra?: ToolExtra): WikiContext {
  const env = process.env;
  const headers = extra?.requestInfo?.headers;

  // --- incoming token / alias: X-Wikijs-Token > Authorization Bearer > authInfo > env ---
  let token = header(headers, 'x-wikijs-token');
  if (!token) {
    const auth = header(headers, 'authorization');
    if (auth && /^bearer\s+/i.test(auth)) token = auth.replace(/^bearer\s+/i, '').trim();
  }
  if (!token && typeof extra?.authInfo?.token === 'string') token = extra.authInfo.token;
  if (!token) token = env.WIKIJS_TOKEN || env.WIKIJS_API_KEY || undefined;

  // --- untrusted per-request overlay (client) — can only tighten ---
  let requestOverlay: PolicyConfig | undefined = parsePolicyConfig(header(headers, 'x-wikijs-policy'));
  const reqPreset = header(headers, 'x-wikijs-preset');
  if (reqPreset) requestOverlay = { preset: reqPreset, ...(requestOverlay ?? {}) };

  let baseUrl: string;
  let realToken: string | undefined;
  let profileOverlay: PolicyConfig | undefined;
  let profileName: string | undefined;

  const profile = resolveProfile(token, env);
  if (profile) {
    // Named profile is authoritative: the client supplied only the (secret) alias.
    // Expose only the non-secret label — never echo the secret alias back anywhere.
    profileName = profile.label ?? '(unlabeled)';
    realToken = profile.token;
    baseUrl = (profile.url || env.WIKIJS_URL || env.WIKIJS_BASE_URL || '').trim();
    if (profile.preset || profile.policy) {
      profileOverlay = parsePolicyConfig({
        preset: profile.preset,
        categories: profile.policy?.categories,
        tools: profile.policy?.tools,
      });
    }
  } else {
    realToken = resolveAlias(token, env);
    baseUrl = (
      header(headers, 'x-wikijs-url') ||
      (typeof extra?.authInfo?.extra?.baseUrl === 'string' ? (extra.authInfo.extra.baseUrl as string) : undefined) ||
      env.WIKIJS_URL ||
      env.WIKIJS_BASE_URL ||
      ''
    ).trim();
  }

  if (!baseUrl) {
    throw new Error(
      'No Wiki.js URL configured. Use a WIKIJS_PROFILES alias, send the "X-Wikijs-Url" header, or set WIKIJS_URL.',
    );
  }

  // Layer overlays: profile (operator) first, then request (client). Both only tighten.
  const policy = BASE_POLICY.withOverlay(profileOverlay).withOverlay(requestOverlay);

  return {
    client: new WikiClient(baseUrl, realToken),
    policy,
    baseUrl,
    hasToken: Boolean(realToken),
    profile: profileName,
  };
}
