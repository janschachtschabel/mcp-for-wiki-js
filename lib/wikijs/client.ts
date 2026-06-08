/**
 * Minimal, dependency-free GraphQL client for Wiki.js.
 *
 * Uses the global `fetch` (Node >=18 and the Vercel/Next runtime), so it works
 * in serverless functions without bundling a GraphQL client library.
 */

export interface GraphQLErrorEntry {
  message: string;
  extensions?: Record<string, unknown>;
}

const DEFAULT_TIMEOUT_MS = Number(process.env.WIKIJS_TIMEOUT_MS) || 30_000;

export class WikiClient {
  readonly baseUrl: string;
  private readonly token?: string;
  private readonly timeoutMs: number;

  constructor(baseUrl: string, token?: string, timeoutMs: number = DEFAULT_TIMEOUT_MS) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.token = token;
    this.timeoutMs = timeoutMs;
  }

  get endpoint(): string {
    return `${this.baseUrl}/graphql`;
  }

  async request<T = any>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    // Abort after timeoutMs so a hung Wiki.js never ties up a serverless invocation.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
        },
        body: JSON.stringify({ query, variables }),
        signal: controller.signal,
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(`Wiki.js request timed out after ${this.timeoutMs} ms (${this.endpoint}).`);
      }
      throw new Error(
        `Could not reach Wiki.js at ${this.endpoint}: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      clearTimeout(timer);
    }

    const raw = await res.text();
    let body: { data?: T; errors?: GraphQLErrorEntry[] };
    try {
      body = JSON.parse(raw);
    } catch {
      throw new Error(
        `Wiki.js returned a non-JSON response (HTTP ${res.status}) from ${this.endpoint}. ` +
          `First bytes: ${raw.slice(0, 200)}`,
      );
    }

    if (body.errors && body.errors.length > 0) {
      throw new Error(body.errors.map((e) => e.message).join('; '));
    }
    if (!res.ok) {
      throw new Error(`Wiki.js GraphQL request failed with HTTP ${res.status}`);
    }
    if (body.data === undefined || body.data === null) {
      throw new Error('Wiki.js GraphQL response contained no data.');
    }
    return body.data;
  }
}
