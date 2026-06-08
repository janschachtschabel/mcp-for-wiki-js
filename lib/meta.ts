export const SERVER_INFO = {
  name: 'mcp-wikijs-mv',
  version: '0.1.0',
} as const;

export const INSTRUCTIONS = `Wiki.js gateway over the GraphQL API.

CREDENTIALS (HTTP transport): every request must carry the target Wiki.js instance
and an API key, either as:
  - Authorization: Bearer <wikijs-api-key>   and   X-Wikijs-Url: https://wiki.example.org
  - or X-Wikijs-Token: <wikijs-api-key>       and   X-Wikijs-Url: https://wiki.example.org
On the stdio transport these come from the WIKIJS_URL / WIKIJS_TOKEN env vars.

PERMISSION POLICY: tools are grouped into categories (read, write, delete,
manage_users, manage_groups, manage_system, manage_auth). Each category is set to
allow / confirm / block by the server's policy.
  - blocked tools are hidden or refuse to run.
  - tools in "confirm" mode return a dry-run PREVIEW unless you pass confirm=true.
    Read the preview, then call again with confirm=true to actually execute.

PAGES: identify a page by numeric id, or by path+locale. Use metadataOnly=true to
skip page content (saves tokens) and includeRender=true to also fetch rendered HTML.
For small edits prefer wiki_page_update with edits=[{find,replace}] over resending
the whole content.

ESCAPE HATCH: wiki_graphql runs any raw GraphQL query/mutation for operations not
covered by a dedicated tool.`;
