import { z } from 'zod';
import { ok, assertOk } from '../wikijs/format';
import { DEFAULT_RESPONSE, type ToolDef } from './types';

export const navigationTools: ToolDef[] = [
  {
    name: 'wiki_navigation_get',
    description: 'Get the site navigation tree (per locale).',
    category: 'read',
    inputSchema: {},
    handler: async (_a, ctx) => {
      const data = await ctx.client.request(
        `query{ navigation { tree { locale items { id kind label icon targetType target visibilityMode visibilityGroups } } } }`,
      );
      return ok(data.navigation.tree);
    },
  },
  {
    name: 'wiki_navigation_update_tree',
    description:
      'Replace the navigation tree. Pass the full tree: an array of { locale, items: [...] } objects (same shape returned by wiki_navigation_get).',
    category: 'manage_system',
    inputSchema: {
      tree: z
        .array(
          z.object({
            locale: z.string(),
            items: z.array(z.record(z.any())),
          }),
        )
        .describe('Full navigation tree to set.'),
    },
    handler: async (a, ctx) => {
      const data = await ctx.client.request(
        `mutation($tree:[NavigationTreeInput]!){ navigation { updateTree(tree:$tree){ ${DEFAULT_RESPONSE} } } }`,
        { tree: a.tree },
      );
      assertOk(data.navigation.updateTree.responseResult, 'Update navigation');
      return ok({ locales: a.tree.map((t: any) => t.locale) }, '✅ Navigation updated.');
    },
  },
];
