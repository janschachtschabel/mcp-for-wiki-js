/**
 * Minimal, dependency-free GraphQL client for Wiki.js.
 *
 * Uses the global `fetch` (Node >=18 and the Vercel/Next runtime), so it works
 * in serverless functions without bundling a GraphQL client library.
 *
 * OVERLOAD PROTECTION: all upstream requests pass through a process-wide concurrency
 * gate (WIKIJS_MAX_CONCURRENCY). This caps how many simultaneous GraphQL requests the
 * server fires at Wiki.js so it can never exhaust the Wiki.js DB connection pool. When the
 * gate is full, requests queue briefly; if no slot frees within the timeout, the request is
 * shed with a clear "busy" error instead of piling up into a 60 s pool-acquire hang.
 *
 * NOTE (Vercel/serverless): the gate is per Node instance. A single warm instance serving
 * concurrent invocations is capped globally; if Vercel scales to N instances the effective
 * cap is N × WIKIJS_MAX_CONCURRENCY. Keep (expected instances × cap) below the Wiki.js
 * sustained ceiling. For a hard global cap across instances, back the gate with Redis.
 */

export interface GraphQLErrorEntry {
  message: string;
  extensions?: Record<string, unknown>;
}

const DEFAULT_TIMEOUT_MS = Number(process.env.WIKIJS_TIMEOUT_MS) || 30_000;
const MAX_CONCURRENCY = Math.max(1, Number(process.env.WIKIJS_MAX_CONCURRENCY) || 8);

/**
 * Async counting semaphore: caps concurrent work at `max`, queues the rest FIFO, and
 * rejects (sheds) a queued caller if it can't get a slot within `acquireTimeoutMs`.
 */
export class Semaphore {
  private active = 0;
  private readonly waiters: Array<{ resolve: () => void; reject: (e: Error) => void }> = [];

  constructor(private readonly max: number) {}

  /** Current in-flight count (for tests/diagnostics). */
  get inFlight(): number {
    return this.active;
  }

  async run<T>(fn: () => Promise<T>, acquireTimeoutMs: number): Promise<T> {
    await this.acquire(acquireTimeoutMs);
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private acquire(timeoutMs: number): Promise<void> {
    if (this.active < this.max) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout>;
      const entry = {
        resolve: () => {
          clearTimeout(timer);
          resolve();
        },
        reject,
      };
      timer = setTimeout(() => {
        const i = this.waiters.indexOf(entry);
        if (i >= 0) this.waiters.splice(i, 1);
        reject(
          new Error(
            `Wiki.js gateway busy: ${this.max} concurrent upstream requests already in flight ` +
              `and no slot freed within ${timeoutMs} ms. Try again shortly (raise WIKIJS_MAX_CONCURRENCY ` +
              `only if the Wiki.js DB pool can take it).`,
          ),
        );
      }, timeoutMs);
      this.waiters.push(entry);
    });
  }

  private release(): void {
    const next = this.waiters.shift();
    if (next) {
      // Transfer the slot directly to the next waiter (active count stays the same).
      next.resolve();
    } else {
      this.active--;
    }
  }
}

/** Process-wide gate shared by every WikiClient instance. */
const upstreamGate = new Semaphore(MAX_CONCURRENCY);

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

  /** Run a GraphQL request through the concurrency gate (overload protection). */
  async request<T = any>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    return upstreamGate.run(() => this.send<T>(query, variables), this.timeoutMs);
  }

  private async send<T = any>(query: string, variables: Record<string, unknown>): Promise<T> {
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
