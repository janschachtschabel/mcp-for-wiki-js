import { z } from 'zod';
import { ok, assertOk } from '../wikijs/format';
import { DEFAULT_RESPONSE, type ToolDef } from './types';

export const assetTools: ToolDef[] = [
  {
    name: 'wiki_assets_list',
    description: 'List assets (files/images) inside an asset folder.',
    category: 'read',
    inputSchema: {
      folderId: z.number().int().default(0).describe('Asset folder id (0 = root).'),
      kind: z.enum(['IMAGE', 'BINARY', 'ALL']).default('ALL'),
    },
    handler: async (a, ctx) => {
      const data = await ctx.client.request(
        `query($folderId:Int!,$kind:AssetKind!){ assets { list(folderId:$folderId,kind:$kind){ id filename ext kind mime fileSize metadata createdAt updatedAt } } }`,
        { folderId: a.folderId ?? 0, kind: a.kind ?? 'ALL' },
      );
      return ok(data.assets.list);
    },
  },
  {
    name: 'wiki_asset_folders',
    description: 'List sub-folders of an asset folder.',
    category: 'read',
    inputSchema: { parentFolderId: z.number().int().default(0).describe('Parent folder id (0 = root).') },
    handler: async (a, ctx) => {
      const data = await ctx.client.request(
        `query($parentFolderId:Int!){ assets { folders(parentFolderId:$parentFolderId){ id slug name } } }`,
        { parentFolderId: a.parentFolderId ?? 0 },
      );
      return ok(data.assets.folders);
    },
  },
  {
    name: 'wiki_asset_create_folder',
    description: 'Create a new asset folder.',
    category: 'write',
    inputSchema: {
      parentFolderId: z.number().int().default(0),
      slug: z.string().min(1).describe('URL-safe folder slug.'),
      name: z.string().optional(),
    },
    handler: async (a, ctx) => {
      const data = await ctx.client.request(
        `mutation($parentFolderId:Int!,$slug:String!,$name:String){ assets { createFolder(parentFolderId:$parentFolderId,slug:$slug,name:$name){ ${DEFAULT_RESPONSE} } } }`,
        { parentFolderId: a.parentFolderId ?? 0, slug: a.slug, name: a.name },
      );
      assertOk(data.assets.createFolder.responseResult, 'Create asset folder');
      return ok({ slug: a.slug }, '✅ Asset folder created.');
    },
  },
  {
    name: 'wiki_asset_rename',
    description: 'Rename an asset (file).',
    category: 'write',
    inputSchema: { id: z.number().int(), filename: z.string().min(1) },
    handler: async (a, ctx) => {
      const data = await ctx.client.request(
        `mutation($id:Int!,$filename:String!){ assets { renameAsset(id:$id,filename:$filename){ ${DEFAULT_RESPONSE} } } }`,
        { id: a.id, filename: a.filename },
      );
      assertOk(data.assets.renameAsset.responseResult, 'Rename asset');
      return ok({ id: a.id, filename: a.filename }, '✅ Asset renamed.');
    },
  },
  {
    name: 'wiki_asset_delete',
    description: 'Delete an asset (file) by id.',
    category: 'delete',
    inputSchema: { id: z.number().int() },
    handler: async (a, ctx) => {
      const data = await ctx.client.request(
        `mutation($id:Int!){ assets { deleteAsset(id:$id){ ${DEFAULT_RESPONSE} } } }`,
        { id: a.id },
      );
      assertOk(data.assets.deleteAsset.responseResult, 'Delete asset');
      return ok({ id: a.id }, '🗑️ Asset deleted.');
    },
  },
  {
    name: 'wiki_assets_flush_temp',
    description: 'Flush temporary/abandoned uploads.',
    category: 'manage_system',
    inputSchema: {},
    handler: async (_a, ctx) => {
      const data = await ctx.client.request(`mutation{ assets { flushTempUploads { ${DEFAULT_RESPONSE} } } }`);
      assertOk(data.assets.flushTempUploads.responseResult, 'Flush temp uploads');
      return ok({ flushed: true }, '✅ Temp uploads flushed.');
    },
  },
];
