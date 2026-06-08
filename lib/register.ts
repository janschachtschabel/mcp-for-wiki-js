import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { allTools, type ToolDef } from './tools/index';
import { resolveContext, basePolicy, type ToolExtra } from './context';
import { fail } from './wikijs/format';
import type { Category } from './permissions';

const CATEGORY_LABEL: Record<Category, string> = {
  read: 'read',
  write: 'write',
  delete: 'delete (destructive)',
  manage_users: 'user management',
  manage_groups: 'group / permission management',
  manage_system: 'system administration',
  manage_auth: 'authentication / API keys',
};

function annotationsFor(tool: ToolDef): ToolAnnotations {
  const base: ToolAnnotations = { title: tool.title ?? tool.name };
  if (tool.category === 'read') return { ...base, readOnlyHint: true, openWorldHint: true };
  if (tool.category === 'delete') return { ...base, destructiveHint: true, openWorldHint: true };
  if (tool.category === 'manage_system' || tool.category === 'manage_auth') {
    return { ...base, destructiveHint: true, openWorldHint: true };
  }
  return { ...base, openWorldHint: true };
}

function describe(tool: ToolDef, confirmable: boolean): string {
  const note =
    `\n\nPolicy category: ${CATEGORY_LABEL[tool.category]}.` +
    (confirmable
      ? ' When the active policy sets this to "confirm", a dry-run preview is returned unless you pass confirm=true.'
      : '');
  return tool.description + note;
}

function confirmPreview(tool: ToolDef, args: Record<string, unknown>): CallToolResult {
  const shown = { ...args };
  delete (shown as Record<string, unknown>).confirm;
  const summary = tool.description.split('\n')[0];
  const text =
    `⚠️ Confirmation required — '${tool.name}' is gated by policy (category: ${CATEGORY_LABEL[tool.category]}).\n\n` +
    `Action: ${summary}\n\n` +
    `Arguments:\n${JSON.stringify(shown, null, 2)}\n\n` +
    `This was a DRY RUN — nothing has changed. To execute, call '${tool.name}' again with "confirm": true.`;
  return { content: [{ type: 'text', text }] };
}

/**
 * Register all tools on an McpServer, applying the permission policy:
 *  - registration uses the deployment BASELINE policy (env) to hide blocked tools,
 *  - each invocation re-resolves the EFFECTIVE policy (baseline + per-request overlay)
 *    so a request header can only ever tighten access.
 */
export function registerAll(server: McpServer): void {
  const base = basePolicy();

  for (const tool of allTools) {
    const baseMode = base.resolve(tool.name, tool.category);
    if (baseMode === 'block' && !base.showBlocked) continue; // hidden at the deployment level

    const confirmable = tool.category !== 'read';
    const shape: Record<string, z.ZodTypeAny> = { ...(tool.inputSchema as Record<string, z.ZodTypeAny>) };
    if (confirmable) {
      shape.confirm = z
        .boolean()
        .optional()
        .describe('Set true to execute when this action is gated by a "confirm" policy.');
    }

    server.registerTool(
      tool.name,
      {
        title: tool.title ?? tool.name,
        description: describe(tool, confirmable),
        inputSchema: shape,
        annotations: annotationsFor(tool),
      },
      async (args: Record<string, unknown>, extra: ToolExtra): Promise<CallToolResult> => {
        try {
          const ctx = resolveContext(extra);
          const mode = ctx.policy.resolve(tool.name, tool.category);
          if (mode === 'block') {
            return fail(
              `Tool '${tool.name}' is blocked by the active permission policy (category: ${tool.category}).`,
            );
          }
          if (mode === 'confirm' && (args as { confirm?: boolean }).confirm !== true) {
            return confirmPreview(tool, args ?? {});
          }
          return await tool.handler(args ?? {}, ctx);
        } catch (e) {
          return fail(e instanceof Error ? e.message : String(e));
        }
      },
    );
  }
}
