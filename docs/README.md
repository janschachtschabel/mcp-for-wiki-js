# Dokumentation — mcp-wikijs-mv

Ein MCP-Server für Wiki.js: volle GraphQL-API-Abdeckung, Mehrbenutzer-Betrieb mit eigenen API-Keys, feingranulare Rechtesteuerung. Läuft auf Vercel (Streamable HTTP) und lokal (stdio).

## Inhalt

| Doku | Worum geht's |
|---|---|
| [Client-Einrichtung: Claude](./clients-claude.md) | **Claude Code (CLI & Web)**, claude.ai-Web-Connector, Claude Desktop, Cursor |
| [Client-Einrichtung: ChatGPT](./clients-chatgpt.md) | **ChatGPT Developer Mode** (Custom MCP Connector) |
| [Rechtesteuerung](./permissions.md) | Presets, `allow`/`confirm`/`block`, pro-User-Verschärfung |
| [Ausbaustufe 1: Admin-Tools](./admin-extension.md) | Wofür die noch nicht als Einzel-Tool gebauten Admin-Funktionen sind (Theming, Storage, Mail, …) |

---

## Das Wichtigste zuerst: die 3 Wege, Zugangsdaten zu übergeben

Der Server hält **keinen** fest verdrahteten Wiki.js-Key. Es gibt drei Muster, wie ein Client dem Server sagt, *welche Wiki.js-Instanz* und *welcher Key* benutzt werden soll. **Welches Muster geht, hängt vom Client ab** — das ist der entscheidende Punkt für die Einrichtung:

### A) Server-Env (Single-Tenant) — funktioniert in JEDEM Client
Beim Deploy `WIKIJS_URL` + `WIKIJS_TOKEN` als Umgebungsvariablen setzen. Alle, die diesen Deploy nutzen, arbeiten auf **dieser einen** Instanz mit **diesem einen** Key. Der Client braucht dann **keine** Auth — nur die URL `https://<deploy>/mcp`.
- ✅ Am einfachsten & sichersten (Key verlässt den Server nie).
- 👤 Gut, wenn jede Person ihren **eigenen** Deploy macht, oder ein Team eine gemeinsame Instanz teilt.

### B) Request-Header (Multi-Tenant) — nur Header-fähige Clients
Pro Request: `X-Wikijs-Url` + (`Authorization: Bearer <key>` **oder** `X-Wikijs-Token: <key>`). **Ein** Deploy bedient beliebig viele Nutzer/Instanzen.
- ✅ Clients: **Claude Code (CLI & Web), Claude Desktop, Cursor** — alles, was eigene MCP-Header erlaubt.
- ❌ **Nicht** in claude.ai-Web-Connectors und ChatGPT (die unterstützen keine Custom-Header).

### C) URL-Parameter (Multi-Tenant) — für Header-lose Clients
Persönliche Connector-URL: `https://<deploy>/mcp?url=<wiki>&token=<key-oder-alias>`. **Ein** Deploy, pro Nutzer eine eigene URL.
- ✅ Clients: **claude.ai-Web-Connector, ChatGPT Developer Mode** (und alle anderen).
- ⚠️ Der Key steht in der URL. **Empfehlung:** statt des echten Keys einen **Alias** verwenden und serverseitig per `WIKIJS_KEY_MAP` auf den echten Key mappen (siehe unten) — dann liegt der echte Key nie im Client/Log.

| | Env (A) | Header (B) | URL-Param (C) |
|---|---|---|---|
| Claude Code CLI | ✅ | ✅ | ✅ |
| Claude Code Web / claude.ai-Connector | ✅ | ❌ | ✅ |
| ChatGPT Developer Mode | ✅ | ❌ | ✅ |
| Claude Desktop / Cursor (stdio) | ✅ (Env) | — | — |

### Query-Parameter (Muster C) im Überblick
| Parameter | Alias | Wirkung |
|---|---|---|
| `?token=` | `?key=` | Wiki.js-API-Key (oder Alias aus `WIKIJS_KEY_MAP`) |
| `?url=` | `?wiki=` | Basis-URL der Wiki.js-Instanz |
| `?preset=` | – | Policy-Preset pro Nutzer (nur verschärfend), z. B. `readonly` |
| `?policy=` | – | JSON-Policy-Override (URL-encodiert, nur verschärfend) |

Echte Header haben Vorrang vor Query-Parametern.

### Alias-Map (empfohlen für Muster C)
Damit der echte Key nie in einer URL steht, beim Deploy setzen:
```bash
WIKIJS_KEY_MAP={"alice":"<echter-key-alice>","bob":"<echter-key-bob>"}
```
Alice bekommt dann die URL `https://<deploy>/mcp?url=https://wiki.example.org&token=alice`.

---

## Wiki.js-API-Key erzeugen
In Wiki.js: **Administration → API** → API aktivieren → **New API Key** → Name + Ablauf wählen → Key kopieren. Dieser Key ist `<key>` in allen Anleitungen. Die in Wiki.js für diesen Key/seine Gruppe hinterlegten Rechte gelten **zusätzlich** zur Policy dieses MCP-Servers.
