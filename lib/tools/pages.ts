import { z } from 'zod';
import { ok, assertOk, wildcardToRegExp, truncateContent } from '../wikijs/format';
import { DEFAULT_RESPONSE, type ToolDef } from './types';
import type { WikiContext } from '../context';

const PAGE_META_FIELDS =
  'id path title description isPrivate isPublished locale contentType createdAt updatedAt authorId authorName creatorId creatorName tags { tag title }';

/** Default soft cap on returned page content, to protect the model's context window. */
const DEFAULT_MAX_CONTENT = 100_000;

function singleSelection(includeContent: boolean, includeRender: boolean): string {
  return `${PAGE_META_FIELDS}${includeContent ? ' content editor' : ''}${includeRender ? ' render toc' : ''}`;
}

const DELETE_PAGE = `mutation($id:Int!){ pages { delete(id:$id) { ${DEFAULT_RESPONSE} } } }`;
const LIST_ALL_PATHS = `query($locale:String){ pages { list(locale:$locale) { id path locale title } } }`;

async function resolvePathToId(ctx: WikiContext, path: string, locale: string): Promise<number | null> {
  const data = await ctx.client.request<{ pages: { singleByPath: { id: number } | null } }>(
    `query($path:String!,$locale:String!){ pages { singleByPath(path:$path,locale:$locale){ id } } }`,
    { path, locale },
  );
  return data.pages.singleByPath?.id ?? null;
}

/** Resolve a page id from either an explicit id or a path+locale pair. */
async function requirePageId(ctx: WikiContext, a: { id?: number; path?: string; locale?: string }): Promise<number> {
  if (a.id != null) return a.id;
  if (a.path) {
    const id = await resolvePathToId(ctx, a.path, a.locale ?? 'en');
    if (id == null) throw new Error(`No page at ${a.path} (${a.locale ?? 'en'}).`);
    return id;
  }
  throw new Error('Provide either "id" or "path".');
}

export const pageTools: ToolDef[] = [
  // ------------------------------------------------------------------ READ ---
  {
    name: 'wiki_pages_search',
    description: 'Full-text search for pages by query string, optionally scoped to a path prefix and locale.',
    category: 'read',
    inputSchema: {
      query: z.string().min(1).describe('Search query.'),
      path: z.string().optional().describe('Restrict to this path prefix.'),
      locale: z.string().optional().describe('Restrict to this locale (e.g. "en", "de").'),
    },
    handler: async (a, ctx) => {
      const data = await ctx.client.request(
        `query($query:String!,$path:String,$locale:String){ pages { search(query:$query,path:$path,locale:$locale){ results { id title description path locale } suggestions totalHits } } }`,
        { query: a.query, path: a.path, locale: a.locale },
      );
      return ok(data.pages.search);
    },
  },
  {
    name: 'wiki_page_get',
    description: 'Get a single page by numeric id OR by path+locale. Use metadataOnly to skip content.',
    category: 'read',
    inputSchema: {
      id: z.number().int().optional().describe('Page id (mutually exclusive with path).'),
      path: z.string().optional().describe('Page path, e.g. "docs/intro" (requires locale).'),
      locale: z.string().default('en').describe('Locale for path lookup. Default "en".'),
      metadataOnly: z.boolean().default(false).describe('If true, omit the page content/body.'),
      includeRender: z.boolean().default(false).describe('If true, also return rendered HTML and TOC.'),
      maxContentChars: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe(`Truncate content above this many chars (default ${DEFAULT_MAX_CONTENT}; 0 = unlimited).`),
    },
    handler: async (a, ctx) => {
      const selection = singleSelection(!a.metadataOnly, !!a.includeRender);
      const limit = a.maxContentChars ?? DEFAULT_MAX_CONTENT;
      if (a.id != null) {
        const data = await ctx.client.request(
          `query($id:Int!){ pages { single(id:$id){ ${selection} } } }`,
          { id: a.id },
        );
        return ok(truncateContent(data.pages.single, limit) ?? { error: `No page with id ${a.id}` });
      }
      if (a.path) {
        const data = await ctx.client.request(
          `query($path:String!,$locale:String!){ pages { singleByPath(path:$path,locale:$locale){ ${selection} } } }`,
          { path: a.path, locale: a.locale ?? 'en' },
        );
        return ok(
          truncateContent(data.pages.singleByPath, limit) ?? { error: `No page at ${a.path} (${a.locale ?? 'en'})` },
        );
      }
      throw new Error('Provide either "id" or "path".');
    },
  },
  {
    name: 'wiki_pages_list',
    description: 'List pages with optional filtering by locale/tags and ordering.',
    category: 'read',
    inputSchema: {
      limit: z.number().int().positive().optional().describe('Max number of pages.'),
      locale: z.string().optional(),
      tags: z.array(z.string()).optional().describe('Only pages carrying all of these tags.'),
      orderBy: z.enum(['CREATED', 'ID', 'PATH', 'TITLE', 'UPDATED']).default('TITLE'),
      orderByDirection: z.enum(['ASC', 'DESC']).default('ASC'),
      creatorId: z.number().int().optional(),
      authorId: z.number().int().optional(),
    },
    handler: async (a, ctx) => {
      const data = await ctx.client.request(
        `query($limit:Int,$orderBy:PageOrderBy,$orderByDirection:PageOrderByDirection,$tags:[String!],$locale:String,$creatorId:Int,$authorId:Int){ pages { list(limit:$limit,orderBy:$orderBy,orderByDirection:$orderByDirection,tags:$tags,locale:$locale,creatorId:$creatorId,authorId:$authorId){ id path locale title description contentType isPublished isPrivate createdAt updatedAt tags } } }`,
        {
          limit: a.limit,
          orderBy: a.orderBy ?? 'TITLE',
          orderByDirection: a.orderByDirection ?? 'ASC',
          tags: a.tags,
          locale: a.locale,
          creatorId: a.creatorId,
          authorId: a.authorId,
        },
      );
      return ok(data.pages.list);
    },
  },
  {
    name: 'wiki_pages_tree',
    description: 'Get the hierarchical page/folder tree under a path or parent folder id.',
    category: 'read',
    inputSchema: {
      path: z.string().optional().describe('Folder path to list under (root = "").'),
      parent: z.number().int().optional().describe('Parent folder id (alternative to path).'),
      mode: z.enum(['FOLDERS', 'PAGES', 'ALL']).default('ALL'),
      locale: z.string().default('en'),
      includeAncestors: z.boolean().default(false),
    },
    handler: async (a, ctx) => {
      const data = await ctx.client.request(
        `query($path:String,$parent:Int,$mode:PageTreeMode!,$locale:String!,$includeAncestors:Boolean){ pages { tree(path:$path,parent:$parent,mode:$mode,locale:$locale,includeAncestors:$includeAncestors){ id path depth title isPrivate isFolder privateNS parent pageId locale } } }`,
        {
          path: a.parent != null ? undefined : (a.path ?? ''),
          parent: a.parent,
          mode: a.mode ?? 'ALL',
          locale: a.locale ?? 'en',
          includeAncestors: !!a.includeAncestors,
        },
      );
      return ok(data.pages.tree);
    },
  },
  {
    name: 'wiki_page_history',
    description: 'Get the version/edit history trail of a page.',
    category: 'read',
    inputSchema: {
      id: z.number().int().describe('Page id.'),
      offsetPage: z.number().int().default(0),
      offsetSize: z.number().int().default(100),
    },
    handler: async (a, ctx) => {
      const data = await ctx.client.request(
        `query($id:Int!,$offsetPage:Int,$offsetSize:Int){ pages { history(id:$id,offsetPage:$offsetPage,offsetSize:$offsetSize){ trail { versionId versionDate authorId authorName actionType valueBefore valueAfter } total } } }`,
        { id: a.id, offsetPage: a.offsetPage ?? 0, offsetSize: a.offsetSize ?? 100 },
      );
      return ok(data.pages.history);
    },
  },
  {
    name: 'wiki_page_version',
    description: 'Get the full content of one historical version of a page.',
    category: 'read',
    inputSchema: {
      pageId: z.number().int(),
      versionId: z.number().int(),
    },
    handler: async (a, ctx) => {
      const data = await ctx.client.request(
        `query($pageId:Int!,$versionId:Int!){ pages { version(pageId:$pageId,versionId:$versionId){ versionId pageId path title description content contentType editor locale isPrivate isPublished tags action authorName versionDate createdAt } } }`,
        { pageId: a.pageId, versionId: a.versionId },
      );
      return ok(data.pages.version);
    },
  },
  {
    name: 'wiki_pages_links',
    description: 'List all internal links between pages for a locale (useful for finding broken links).',
    category: 'read',
    inputSchema: { locale: z.string().default('en') },
    handler: async (a, ctx) => {
      const data = await ctx.client.request(
        `query($locale:String!){ pages { links(locale:$locale){ id path title links } } }`,
        { locale: a.locale ?? 'en' },
      );
      return ok(data.pages.links);
    },
  },
  {
    name: 'wiki_tags_list',
    description: 'List all tags defined in the wiki.',
    category: 'read',
    inputSchema: {},
    handler: async (_a, ctx) => {
      const data = await ctx.client.request(
        `query{ pages { tags { id tag title createdAt updatedAt } } }`,
      );
      return ok(data.pages.tags);
    },
  },
  {
    name: 'wiki_tags_search',
    description: 'Suggest tags matching a partial query.',
    category: 'read',
    inputSchema: { query: z.string().min(1) },
    handler: async (a, ctx) => {
      const data = await ctx.client.request(`query($query:String!){ pages { searchTags(query:$query) } }`, {
        query: a.query,
      });
      return ok(data.pages.searchTags);
    },
  },

  // ----------------------------------------------------------------- WRITE ---
  {
    name: 'wiki_page_create',
    description: 'Create a new page at the given path with markdown content.',
    category: 'write',
    inputSchema: {
      path: z.string().min(1).describe('Page path, e.g. "docs/getting-started".'),
      title: z.string().min(1),
      content: z.string().describe('Page body (markdown by default).'),
      description: z.string().default(''),
      editor: z.string().default('markdown').describe('Editor type: markdown | html | ...'),
      locale: z.string().default('en'),
      tags: z.array(z.string()).default([]),
      isPublished: z.boolean().default(true),
      isPrivate: z.boolean().default(false),
      scriptCss: z.string().optional(),
      scriptJs: z.string().optional(),
    },
    handler: async (a, ctx) => {
      const data = await ctx.client.request(
        `mutation($content:String!,$description:String!,$editor:String!,$isPublished:Boolean!,$isPrivate:Boolean!,$locale:String!,$path:String!,$tags:[String]!,$title:String!,$scriptCss:String,$scriptJs:String){ pages { create(content:$content,description:$description,editor:$editor,isPublished:$isPublished,isPrivate:$isPrivate,locale:$locale,path:$path,tags:$tags,title:$title,scriptCss:$scriptCss,scriptJs:$scriptJs){ ${DEFAULT_RESPONSE} page { id path title } } } }`,
        {
          content: a.content,
          description: a.description ?? '',
          editor: a.editor ?? 'markdown',
          isPublished: a.isPublished ?? true,
          isPrivate: a.isPrivate ?? false,
          locale: a.locale ?? 'en',
          path: a.path,
          tags: a.tags ?? [],
          title: a.title,
          scriptCss: a.scriptCss,
          scriptJs: a.scriptJs,
        },
      );
      assertOk(data.pages.create.responseResult, 'Create page');
      return ok(data.pages.create.page, '✅ Page created.');
    },
  },
  {
    name: 'wiki_page_update',
    description:
      'Update a page by id. Either replace the whole content, or apply surgical edits=[{find,replace}] to the existing content. Fields you omit are preserved (the current page is fetched first), so metadata-only updates never wipe content/tags.',
    category: 'write',
    inputSchema: {
      id: z.number().int(),
      content: z.string().optional().describe('Full replacement content.'),
      edits: z
        .array(z.object({ find: z.string(), replace: z.string() }))
        .optional()
        .describe('Find/replace edits applied to current content (alternative to content).'),
      title: z.string().optional(),
      description: z.string().optional(),
      tags: z.array(z.string()).optional(),
      editor: z.string().optional(),
      locale: z.string().optional(),
      path: z.string().optional().describe('New path (renames the page).'),
      isPublished: z.boolean().optional(),
      isPrivate: z.boolean().optional(),
      scriptCss: z.string().optional(),
      scriptJs: z.string().optional(),
    },
    handler: async (a, ctx) => {
      if (a.content != null && a.edits && a.edits.length > 0) {
        throw new Error('Provide either "content" or "edits", not both.');
      }
      // Fetch the current page so omitted fields are preserved. Wiki.js' update
      // mutation otherwise clears unspecified required fields (content, tags, ...).
      type Cur = {
        path: string;
        locale: string;
        title: string;
        description: string;
        editor: string;
        isPublished: boolean;
        isPrivate: boolean;
        content: string;
        tags: { tag: string }[];
      };
      const cur = await ctx.client.request<{ pages: { single: Cur | null } }>(
        `query($id:Int!){ pages { single(id:$id){ path locale title description editor isPublished isPrivate content tags { tag } } } }`,
        { id: a.id },
      );
      const p = cur.pages.single;
      if (!p) throw new Error(`No page with id ${a.id}`);

      let content = a.content ?? p.content ?? '';
      if (a.edits && a.edits.length > 0) {
        let body = p.content ?? '';
        for (const e of a.edits) {
          if (!body.includes(e.find)) throw new Error(`edit failed: text not found: ${JSON.stringify(e.find)}`);
          body = body.split(e.find).join(e.replace);
        }
        content = body;
      }
      const tags = a.tags ?? (p.tags ?? []).map((t) => t.tag);

      const data = await ctx.client.request(
        `mutation($id:Int!,$content:String,$description:String,$editor:String,$isPrivate:Boolean,$isPublished:Boolean,$locale:String,$path:String,$tags:[String],$title:String,$scriptCss:String,$scriptJs:String){ pages { update(id:$id,content:$content,description:$description,editor:$editor,isPrivate:$isPrivate,isPublished:$isPublished,locale:$locale,path:$path,tags:$tags,title:$title,scriptCss:$scriptCss,scriptJs:$scriptJs){ ${DEFAULT_RESPONSE} page { id path title updatedAt } } } }`,
        {
          id: a.id,
          content,
          description: a.description ?? p.description ?? '',
          editor: a.editor ?? p.editor,
          isPrivate: a.isPrivate ?? p.isPrivate,
          isPublished: a.isPublished ?? p.isPublished,
          locale: a.locale ?? p.locale,
          path: a.path ?? p.path,
          tags,
          title: a.title ?? p.title,
          scriptCss: a.scriptCss,
          scriptJs: a.scriptJs,
        },
      );
      assertOk(data.pages.update.responseResult, 'Update page');
      return ok(data.pages.update.page, '✅ Page updated.');
    },
  },
  {
    name: 'wiki_page_move',
    description: 'Move/rename a page (identified by id OR path+locale) to a new path and/or locale.',
    category: 'write',
    inputSchema: {
      id: z.number().int().optional().describe('Page id (or use path+locale).'),
      path: z.string().optional().describe('Current page path (alternative to id).'),
      locale: z.string().default('en').describe('Current locale (for path lookup).'),
      destinationPath: z.string().min(1),
      destinationLocale: z.string().default('en'),
    },
    handler: async (a, ctx) => {
      const id = await requirePageId(ctx, a);
      const data = await ctx.client.request(
        `mutation($id:Int!,$destinationPath:String!,$destinationLocale:String!){ pages { move(id:$id,destinationPath:$destinationPath,destinationLocale:$destinationLocale){ ${DEFAULT_RESPONSE} } } }`,
        { id, destinationPath: a.destinationPath, destinationLocale: a.destinationLocale ?? 'en' },
      );
      assertOk(data.pages.move.responseResult, 'Move page');
      return ok({ id, destinationPath: a.destinationPath }, '✅ Page moved.');
    },
  },
  {
    name: 'wiki_page_render',
    description: 'Re-render a page (rebuild its cached HTML output).',
    category: 'write',
    inputSchema: { id: z.number().int() },
    handler: async (a, ctx) => {
      const data = await ctx.client.request(
        `mutation($id:Int!){ pages { render(id:$id){ ${DEFAULT_RESPONSE} } } }`,
        { id: a.id },
      );
      assertOk(data.pages.render.responseResult, 'Render page');
      return ok({ id: a.id }, '✅ Page re-rendered.');
    },
  },
  {
    name: 'wiki_page_restore',
    description: 'Restore a page to a previous version.',
    category: 'write',
    inputSchema: { pageId: z.number().int(), versionId: z.number().int() },
    handler: async (a, ctx) => {
      const data = await ctx.client.request(
        `mutation($pageId:Int!,$versionId:Int!){ pages { restore(pageId:$pageId,versionId:$versionId){ ${DEFAULT_RESPONSE} } } }`,
        { pageId: a.pageId, versionId: a.versionId },
      );
      assertOk(data.pages.restore.responseResult, 'Restore page');
      return ok({ pageId: a.pageId, versionId: a.versionId }, '✅ Page restored.');
    },
  },
  {
    name: 'wiki_page_convert',
    description: 'Convert a page to a different editor/content type (e.g. markdown → html).',
    category: 'write',
    inputSchema: { id: z.number().int(), editor: z.string().describe('Target editor, e.g. "markdown".') },
    handler: async (a, ctx) => {
      const data = await ctx.client.request(
        `mutation($id:Int!,$editor:String!){ pages { convert(id:$id,editor:$editor){ ${DEFAULT_RESPONSE} } } }`,
        { id: a.id, editor: a.editor },
      );
      assertOk(data.pages.convert.responseResult, 'Convert page');
      return ok({ id: a.id, editor: a.editor }, '✅ Page converted.');
    },
  },
  {
    name: 'wiki_tag_update',
    description: 'Rename / retitle a tag.',
    category: 'write',
    inputSchema: { id: z.number().int(), tag: z.string(), title: z.string() },
    handler: async (a, ctx) => {
      const data = await ctx.client.request(
        `mutation($id:Int!,$tag:String!,$title:String!){ pages { updateTag(id:$id,tag:$tag,title:$title){ ${DEFAULT_RESPONSE} } } }`,
        { id: a.id, tag: a.tag, title: a.title },
      );
      assertOk(data.pages.updateTag.responseResult, 'Update tag');
      return ok({ id: a.id, tag: a.tag }, '✅ Tag updated.');
    },
  },

  // ---------------------------------------------------------------- DELETE ---
  {
    name: 'wiki_page_delete',
    description: 'Permanently delete a single page, identified by id OR path+locale.',
    category: 'delete',
    inputSchema: {
      id: z.number().int().optional().describe('Page id (or use path+locale).'),
      path: z.string().optional().describe('Page path (alternative to id).'),
      locale: z.string().default('en').describe('Locale for path lookup.'),
    },
    handler: async (a, ctx) => {
      const id = await requirePageId(ctx, a);
      const data = await ctx.client.request(DELETE_PAGE, { id });
      assertOk(data.pages.delete.responseResult, 'Delete page');
      return ok({ id }, '🗑️ Page deleted.');
    },
  },
  {
    name: 'wiki_pages_delete_batch',
    description:
      'Delete multiple pages by ids, by paths, and/or by a wildcard path pattern (e.g. "drafts/*"). Returns a per-page result.',
    category: 'delete',
    inputSchema: {
      ids: z.array(z.number().int()).optional(),
      paths: z.array(z.string()).optional(),
      pathPattern: z.string().optional().describe('Shell-style wildcard against page paths, e.g. "tmp/*".'),
      locale: z.string().default('en').describe('Locale used when resolving "paths".'),
    },
    handler: async (a, ctx) => {
      const ids = new Set<number>();
      (a.ids ?? []).forEach((i: number) => ids.add(i));
      for (const p of a.paths ?? []) {
        const pid = await resolvePathToId(ctx, p, a.locale ?? 'en');
        if (pid) ids.add(pid);
      }
      if (a.pathPattern) {
        const all = await ctx.client.request<{ pages: { list: { id: number; path: string }[] } }>(LIST_ALL_PATHS, {});
        const rx = wildcardToRegExp(a.pathPattern);
        for (const pg of all.pages.list) if (rx.test(pg.path)) ids.add(pg.id);
      }
      const targets = [...ids];
      if (targets.length === 0) return ok({ deleted: 0, results: [], message: 'No matching pages found.' });
      const results: { id: number; deleted: boolean; error?: string }[] = [];
      for (const id of targets) {
        try {
          const data = await ctx.client.request(DELETE_PAGE, { id });
          assertOk(data.pages.delete.responseResult, `Delete page ${id}`);
          results.push({ id, deleted: true });
        } catch (e) {
          results.push({ id, deleted: false, error: e instanceof Error ? e.message : String(e) });
        }
      }
      return ok({ total: targets.length, deleted: results.filter((r) => r.deleted).length, results });
    },
  },
  {
    name: 'wiki_pages_delete_tree',
    description:
      'Delete a page subtree under rootPath. mode: "children_only" (keep root), "include_root" (root + descendants), "root_only".',
    category: 'delete',
    inputSchema: {
      rootPath: z.string().min(1),
      mode: z.enum(['children_only', 'include_root', 'root_only']).default('children_only'),
    },
    handler: async (a, ctx) => {
      const root = String(a.rootPath).replace(/\/+$/, '');
      const all = await ctx.client.request<{ pages: { list: { id: number; path: string }[] } }>(LIST_ALL_PATHS, {});
      let targets = all.pages.list.filter((p) => p.path === root || p.path.startsWith(`${root}/`));
      const mode = a.mode ?? 'children_only';
      if (mode === 'children_only') targets = targets.filter((p) => p.path !== root);
      else if (mode === 'root_only') targets = targets.filter((p) => p.path === root);
      // delete deepest paths first to avoid dependency issues
      targets.sort((x, y) => y.path.split('/').length - x.path.split('/').length);
      const results: { id: number; path: string; deleted: boolean; error?: string }[] = [];
      for (const pg of targets) {
        try {
          const data = await ctx.client.request(DELETE_PAGE, { id: pg.id });
          assertOk(data.pages.delete.responseResult, `Delete page ${pg.id}`);
          results.push({ id: pg.id, path: pg.path, deleted: true });
        } catch (e) {
          results.push({ id: pg.id, path: pg.path, deleted: false, error: e instanceof Error ? e.message : String(e) });
        }
      }
      return ok({ root, mode, total: targets.length, deleted: results.filter((r) => r.deleted).length, results });
    },
  },
  {
    name: 'wiki_tag_delete',
    description: 'Delete a tag by id.',
    category: 'delete',
    inputSchema: { id: z.number().int() },
    handler: async (a, ctx) => {
      const data = await ctx.client.request(
        `mutation($id:Int!){ pages { deleteTag(id:$id){ ${DEFAULT_RESPONSE} } } }`,
        { id: a.id },
      );
      assertOk(data.pages.deleteTag.responseResult, 'Delete tag');
      return ok({ id: a.id }, '🗑️ Tag deleted.');
    },
  },
  {
    name: 'wiki_pages_purge_history',
    description: 'Purge page version history older than a duration (e.g. "P1M", "P30D", or "1w").',
    category: 'delete',
    inputSchema: { olderThan: z.string().describe('ISO-8601 duration or relative spec accepted by Wiki.js.') },
    handler: async (a, ctx) => {
      const data = await ctx.client.request(
        `mutation($olderThan:String!){ pages { purgeHistory(olderThan:$olderThan){ ${DEFAULT_RESPONSE} } } }`,
        { olderThan: a.olderThan },
      );
      assertOk(data.pages.purgeHistory.responseResult, 'Purge history');
      return ok({ olderThan: a.olderThan }, '🗑️ History purged.');
    },
  },

  // -------------------------------------------------------- MANAGE_SYSTEM ---
  {
    name: 'wiki_pages_flush_cache',
    description: 'Flush the rendered-pages cache for the whole instance.',
    category: 'manage_system',
    inputSchema: {},
    handler: async (_a, ctx) => {
      const data = await ctx.client.request(`mutation{ pages { flushCache { ${DEFAULT_RESPONSE} } } }`);
      assertOk(data.pages.flushCache.responseResult, 'Flush cache');
      return ok({ flushed: true }, '✅ Page cache flushed.');
    },
  },
  {
    name: 'wiki_pages_rebuild_tree',
    description: 'Rebuild the internal page tree (repairs folder structure).',
    category: 'manage_system',
    inputSchema: {},
    handler: async (_a, ctx) => {
      const data = await ctx.client.request(`mutation{ pages { rebuildTree { ${DEFAULT_RESPONSE} } } }`);
      assertOk(data.pages.rebuildTree.responseResult, 'Rebuild tree');
      return ok({ rebuilt: true }, '✅ Page tree rebuilt.');
    },
  },
  {
    name: 'wiki_pages_migrate_locale',
    description: 'Migrate all pages from a source locale to a target locale.',
    category: 'manage_system',
    inputSchema: { sourceLocale: z.string(), targetLocale: z.string() },
    handler: async (a, ctx) => {
      const data = await ctx.client.request(
        `mutation($sourceLocale:String!,$targetLocale:String!){ pages { migrateToLocale(sourceLocale:$sourceLocale,targetLocale:$targetLocale){ ${DEFAULT_RESPONSE} } } }`,
        { sourceLocale: a.sourceLocale, targetLocale: a.targetLocale },
      );
      assertOk(data.pages.migrateToLocale.responseResult, 'Migrate locale');
      return ok({ from: a.sourceLocale, to: a.targetLocale }, '✅ Locale migrated.');
    },
  },
];
