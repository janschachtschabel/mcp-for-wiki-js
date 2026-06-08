/**
 * Permission policy engine.
 *
 * Every tool declares a `category`. The policy maps each category (and optionally
 * each individual tool) to a mode:
 *   - allow   : run immediately
 *   - confirm : return a dry-run preview unless the caller passed confirm=true
 *   - block   : hidden from tools/list (or refuses to run)
 *
 * A deployment sets a BASELINE policy via env (preset + JSON overrides). Untrusted
 * per-request overlays (HTTP headers) may only ever make access STRICTER, never
 * looser — so a user can downgrade themselves to read-only but can never unlock a
 * tool the server operator blocked.
 */

export const CATEGORIES = [
  'read',
  'write',
  'delete',
  'manage_users',
  'manage_groups',
  'manage_system',
  'manage_auth',
] as const;

export type Category = (typeof CATEGORIES)[number];
export type PolicyMode = 'allow' | 'confirm' | 'block';

const RANK: Record<PolicyMode, number> = { allow: 0, confirm: 1, block: 2 };

/** The stricter (higher-ranked) of two modes. */
export function strictest(a: PolicyMode, b: PolicyMode): PolicyMode {
  return RANK[a] >= RANK[b] ? a : b;
}

export type CategoryMap = Record<Category, PolicyMode>;

function cat(
  read: PolicyMode,
  write: PolicyMode,
  del: PolicyMode,
  users: PolicyMode,
  groups: PolicyMode,
  system: PolicyMode,
  auth: PolicyMode,
): CategoryMap {
  return {
    read,
    write,
    delete: del,
    manage_users: users,
    manage_groups: groups,
    manage_system: system,
    manage_auth: auth,
  };
}

export const PRESETS: Record<string, CategoryMap> = {
  // read, write, delete, users, groups, system, auth
  readonly: cat('allow', 'block', 'block', 'block', 'block', 'block', 'block'),
  safe: cat('allow', 'confirm', 'confirm', 'block', 'block', 'block', 'block'),
  editor: cat('allow', 'allow', 'confirm', 'block', 'block', 'block', 'block'),
  maintainer: cat('allow', 'allow', 'confirm', 'confirm', 'confirm', 'confirm', 'confirm'),
  full: cat('allow', 'allow', 'allow', 'allow', 'allow', 'allow', 'allow'),
};

export const DEFAULT_PRESET = 'safe';

export interface PolicyConfig {
  preset?: string;
  categories?: Partial<CategoryMap>;
  tools?: Record<string, PolicyMode>;
}

const VALID_MODES = new Set<PolicyMode>(['allow', 'confirm', 'block']);
const VALID_CATEGORIES = new Set<string>(CATEGORIES);

function sanitizeCategories(input: unknown): Partial<CategoryMap> {
  const out: Partial<CategoryMap> = {};
  if (input && typeof input === 'object') {
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      if (VALID_CATEGORIES.has(k) && typeof v === 'string' && VALID_MODES.has(v as PolicyMode)) {
        out[k as Category] = v as PolicyMode;
      }
    }
  }
  return out;
}

function sanitizeTools(input: unknown): Record<string, PolicyMode> {
  const out: Record<string, PolicyMode> = {};
  if (input && typeof input === 'object') {
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      if (typeof v === 'string' && VALID_MODES.has(v as PolicyMode)) out[k] = v as PolicyMode;
    }
  }
  return out;
}

export function parsePolicyConfig(raw: unknown): PolicyConfig | undefined {
  let obj: any = raw;
  if (typeof raw === 'string') {
    if (!raw.trim()) return undefined;
    try {
      obj = JSON.parse(raw);
    } catch {
      return undefined;
    }
  }
  if (!obj || typeof obj !== 'object') return undefined;
  const config: PolicyConfig = {
    preset: typeof obj.preset === 'string' && PRESETS[obj.preset] ? obj.preset : undefined,
    categories: sanitizeCategories(obj.categories),
    tools: sanitizeTools(obj.tools),
  };
  return config;
}

export class Policy {
  constructor(
    private readonly base: CategoryMap,
    private readonly cats: Partial<CategoryMap>,
    private readonly tools: Record<string, PolicyMode>,
    readonly showBlocked: boolean,
    private readonly overlay?: PolicyConfig,
  ) {}

  /** Return a copy carrying an untrusted per-request overlay (can only tighten). */
  withOverlay(overlay?: PolicyConfig): Policy {
    if (!overlay) return this;
    return new Policy(this.base, this.cats, this.tools, this.showBlocked, overlay);
  }

  /** Resolve the effective mode for a tool in a given category. */
  resolve(toolName: string, category: Category): PolicyMode {
    let mode: PolicyMode = this.tools[toolName] ?? this.cats[category] ?? this.base[category];
    if (this.overlay) {
      const presetMap = this.overlay.preset ? PRESETS[this.overlay.preset] : undefined;
      const ov =
        this.overlay.tools?.[toolName] ?? this.overlay.categories?.[category] ?? presetMap?.[category];
      if (ov) mode = strictest(mode, ov);
    }
    return mode;
  }
}

/** Build the deployment-wide baseline policy from environment variables. */
export function basePolicyFromEnv(env: Record<string, string | undefined> = process.env): Policy {
  const presetName = (env.WIKIJS_PERMISSION_PRESET || DEFAULT_PRESET).toLowerCase();
  const base = PRESETS[presetName] ?? PRESETS[DEFAULT_PRESET];
  const override = parsePolicyConfig(env.WIKIJS_POLICY);
  const cats = override?.categories ?? {};
  const tools = override?.tools ?? {};
  const showBlocked = /^(1|true|yes|on)$/i.test(env.WIKIJS_SHOW_BLOCKED || '');
  return new Policy(base, cats, tools, showBlocked);
}
