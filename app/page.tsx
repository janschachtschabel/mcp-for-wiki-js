import { headers } from 'next/headers';
import { allTools } from '../lib/tools/index';
import { SERVER_INFO } from '../lib/meta';

export const dynamic = 'force-dynamic';

const card: React.CSSProperties = {
  background: '#141b33',
  border: '1px solid #25304f',
  borderRadius: 12,
  padding: '18px 22px',
  margin: '14px 0',
};

const code: React.CSSProperties = {
  background: '#0b1020',
  border: '1px solid #25304f',
  borderRadius: 8,
  padding: '12px 14px',
  display: 'block',
  whiteSpace: 'pre-wrap',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  fontSize: 13,
  color: '#bcd0ff',
  overflowX: 'auto',
  margin: '8px 0',
};

const mono: React.CSSProperties = { color: '#bcd0ff', fontFamily: 'ui-monospace, Menlo, Consolas, monospace' };
const h2: React.CSSProperties = { fontSize: 18, margin: '4px 0 2px' };
const muted: React.CSSProperties = { color: '#9fb0db' };
const ol: React.CSSProperties = { color: '#9fb0db', lineHeight: 1.7, margin: '6px 0', paddingLeft: 20 };

export default function Home() {
  const h = headers();
  const proto = h.get('x-forwarded-proto') ?? 'https';
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'your-deploy.example.com';
  const base = `${proto}://${host}`;
  const mcpUrl = `${base}/mcp`;

  const byCategory = allTools.reduce<Record<string, number>>((acc, t) => {
    acc[t.category] = (acc[t.category] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <main style={{ maxWidth: 880, margin: '0 auto', padding: '48px 24px 80px' }}>
      <h1 style={{ fontSize: 30, marginBottom: 4 }}>
        {SERVER_INFO.name} <span style={{ color: '#7d8bb5', fontSize: 18 }}>v{SERVER_INFO.version}</span>
      </h1>
      <p style={{ ...muted, marginTop: 0 }}>
        Wiki.js-MCP-Server — volle GraphQL-API, eigener API-Key pro Nutzer, feingranulare Rechte. Endpoint:{' '}
        <span style={mono}>{mcpUrl}</span>
      </p>

      {/* ChatGPT & claude.ai web — URL parameters (no custom headers needed) */}
      <div style={card}>
        <h2 style={h2}>🔗 ChatGPT (Developer Mode) &amp; claude.ai (Web-Connector)</h2>
        <p style={{ ...muted, marginTop: 2 }}>
          Diese Clients erlauben <strong>keine</strong> Custom-Header — gib deinen Key in der <strong>URL</strong> mit:
        </p>
        <code style={code}>{`${mcpUrl}?url=https://dein-wiki.example.org&token=DEIN_WIKIJS_API_KEY`}</code>
        <ol style={ol}>
          <li>
            <strong>ChatGPT:</strong> Settings → Connectors → (Advanced → Developer mode) → <em>Create / Add custom
            connector</em> → obige URL einfügen → Authentication: <em>No authentication</em> → speichern.
          </li>
          <li>
            <strong>claude.ai:</strong> Settings → Connectors → <em>Add custom connector</em> → obige URL einfügen →{' '}
            <em>Add</em>. (Plan Pro/Max/Team/Enterprise.)
          </li>
        </ol>
        <p style={{ ...muted, fontSize: 13, marginBottom: 0 }}>
          Optional nur lesen: <span style={mono}>&amp;preset=readonly</span> anhängen. Tipp: statt des echten Keys
          einen Alias verwenden (Server-Env <span style={mono}>WIKIJS_KEY_MAP</span>), damit der Key nicht in der URL
          steht.
        </p>
      </div>

      {/* Claude Code / Cursor — headers */}
      <div style={card}>
        <h2 style={h2}>💻 Claude Code (CLI) &amp; Cursor</h2>
        <p style={{ ...muted, marginTop: 2 }}>Diese Clients unterstützen Header — der Key bleibt aus der URL heraus:</p>
        <code style={code}>{`claude mcp add --transport http wikijs ${mcpUrl} \\
  --header "X-Wikijs-Url: https://dein-wiki.example.org" \\
  --header "Authorization: Bearer DEIN_WIKIJS_API_KEY"`}</code>
        <p style={{ ...muted, fontSize: 13, marginBottom: 0 }}>
          Cursor: <span style={mono}>.cursor/mcp.json</span> mit <span style={mono}>url</span> +{' '}
          <span style={mono}>headers</span> (siehe Repo-Doku <span style={mono}>docs/clients-claude.md</span>).
        </p>
      </div>

      {/* Single-tenant note */}
      <div style={card}>
        <h2 style={h2}>🏢 Eine feste Instanz für alle (ohne Key pro Nutzer)</h2>
        <p style={{ ...muted, margin: '2px 0 0' }}>
          Ist der Server mit <span style={mono}>WIKIJS_URL</span> + <span style={mono}>WIKIJS_TOKEN</span> deployt,
          genügt als Connector-URL einfach <span style={mono}>{mcpUrl}</span> — ganz ohne Auth.
        </p>
      </div>

      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        <div style={{ ...card, flex: '1 1 240px' }}>
          <strong>{allTools.length} Tools</strong>
          <ul style={{ ...muted, lineHeight: 1.6, margin: '6px 0 0', paddingLeft: 18 }}>
            {Object.entries(byCategory).map(([cat, n]) => (
              <li key={cat}>
                <span style={mono}>{cat}</span>: {n}
              </li>
            ))}
          </ul>
        </div>
        <div style={{ ...card, flex: '1 1 240px' }}>
          <strong>Rechte (Policy)</strong>
          <p style={{ ...muted, margin: '6px 0 0', fontSize: 13 }}>
            Pro Kategorie <em>allow</em> / <em>confirm</em> (Dry-Run bis <span style={mono}>confirm:true</span>) /{' '}
            <em>block</em>. Preset via <span style={mono}>WIKIJS_PERMISSION_PRESET</span>; pro Nutzer verschärfbar via{' '}
            <span style={mono}>&amp;preset=</span> bzw. <span style={mono}>X-Wikijs-Preset</span>.
          </p>
        </div>
      </div>

      <p style={{ color: '#5f6f9c', fontSize: 13 }}>
        Verbindung prüfen: das Tool <span style={mono}>wiki_connection_status</span> aufrufen lassen. Vollständige
        Doku im Repository unter <span style={mono}>docs/</span>.
      </p>
    </main>
  );
}
