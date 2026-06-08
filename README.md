# mcp-wikijs-mv

Ein **MCP-Server für [Wiki.js](https://js.wiki/)** mit dem Ziel _möglichst vollständiger_ Abdeckung der GraphQL-API, **feingranularer Rechtesteuerung** (pro Funktion/Kategorie: _erlaubt_ / _nur mit Genehmigung_ / _geblockt_) und **Mehrbenutzer-Betrieb mit unterschiedlichen API-Keys**.

Läuft in zwei Modi:

| Modus | Transport | Einsatz | Auth |
|---|---|---|---|
| **HTTP** | Streamable HTTP (`/mcp`) | Deployment auf **Vercel** | API-Key **pro Request** (Header) |
| **stdio** | stdio | lokal (Claude Desktop, Cursor …) | API-Key aus **Env** |

Beides nutzt denselben Tool-Code, dieselbe GraphQL-Schicht und dieselbe Policy-Engine.

## 📖 Dokumentation

| Doku | Inhalt |
|---|---|
| **[Client-Einrichtung: Claude](./docs/clients-claude.md)** | Claude Code (CLI & Web), claude.ai-Connector, Desktop, Cursor — **mit eigenem API-Key pro User** |
| **[Client-Einrichtung: ChatGPT](./docs/clients-chatgpt.md)** | ChatGPT Developer Mode (Custom Connector) — **mit eigenem API-Key pro User** |
| **[Rechtesteuerung](./docs/permissions.md)** | Presets, `allow`/`confirm`/`block`, pro-User-Verschärfung |
| **[Ausbaustufe 1: Admin-Tools erklärt](./docs/admin-extension.md)** | Wofür Theming/Storage/Mail/Search/… sind und wie man sie heute schon nutzt |
| [Doku-Index](./docs/README.md) | Übersicht + die 3 Auth-Muster (Env / Header / URL-Param) |

---

## Warum dieser Server (statt der vorhandenen Lösungen)

Gelernt wurde aus `wikijs-mcp-1`, `wiki-js-mcp`, `wikijs-mcp`, `wikijs-mcp-server`. Keiner davon bietet **gleichzeitig**:

- **Vollständige API-Abdeckung** — ~65 benannte Tools über alle Domänen (Pages, Tags, Assets, Users, Groups, Comments, Navigation, Auth/API-Keys, Site/System) **plus** ein `wiki_graphql`-Escape-Hatch für 100 % Abdeckung.
- **Vercel-tauglich** — stateless Streamable HTTP über `mcp-handler` (kein Session-State, kein Redis nötig).
- **Multi-User** — jeder Client schickt seinen eigenen Wiki.js-Key per Header; kein global geteilter Token.
- **Rechtesteuerung** — Policy-Engine mit `allow` / `confirm` / `block` pro Kategorie **und** pro Tool.

---

## Schnellstart

### 1. Installieren

```bash
cd mcp-wikijs-mv
npm install
```

### 2a. Lokal als stdio-Server

```bash
# .env anlegen (siehe .env.example)
#   WIKIJS_URL=https://dein-wiki.example.org
#   WIKIJS_TOKEN=<wikijs-api-key>
#   WIKIJS_PERMISSION_PRESET=safe
npm run stdio
```

### 2b. Lokal als HTTP-Server (zum Testen vor dem Deploy)

```bash
npm run dev          # http://localhost:3030/mcp
```

### 3. Auf Vercel deployen

```bash
vercel               # bzw. Repo mit Vercel verbinden
```

Standardmäßig sind **keine** Env-Variablen nötig, wenn jeder Client seinen Key per Header mitschickt (siehe [Multi-User](#multi-user--bring-your-own-key)). Für einen Single-Tenant-Server kannst du `WIKIJS_URL` + `WIKIJS_TOKEN` als Vercel-Env setzen.

---

## Verbindung herstellen (Client-Konfiguration)

### HTTP (Vercel / Remote)

Endpoint: `https://<deployment>/mcp`

Erforderliche Header pro Request:

```
Authorization: Bearer <WIKIJS_API_KEY>     # alternativ: X-Wikijs-Token: <key>
X-Wikijs-Url:  https://dein-wiki.example.org
```

Beispiel (`mcp.json` eines HTTP-fähigen Clients):

```jsonc
{
  "mcpServers": {
    "wikijs": {
      "type": "http",
      "url": "https://<deployment>/mcp",
      "headers": {
        "Authorization": "Bearer DEIN_WIKIJS_API_KEY",
        "X-Wikijs-Url": "https://dein-wiki.example.org"
      }
    }
  }
}
```

### stdio (Claude Desktop / Cursor)

```jsonc
{
  "mcpServers": {
    "wikijs": {
      "command": "npm",
      "args": ["--prefix", "/pfad/zu/mcp-wikijs-mv", "run", "stdio"],
      "env": {
        "WIKIJS_URL": "https://dein-wiki.example.org",
        "WIKIJS_TOKEN": "DEIN_WIKIJS_API_KEY",
        "WIKIJS_PERMISSION_PRESET": "editor"
      }
    }
  }
}
```

> **Wiki.js-API-Key erzeugen:** Administration → **API** → API aktivieren → **New API Key**. Der Key wird als `Authorization: Bearer …` verwendet. Die im Key/in den Gruppen hinterlegten Wiki.js-Rechte gelten zusätzlich zur Policy dieses Servers.

---

## Multi-User / Bring-your-own-Key

Der Server hält **keinen** globalen Token. Es gibt **3 Wege**, Zugangsdaten zu übergeben — welcher geht, hängt vom Client ab. **→ Vollständige Anleitungen pro Client in [`docs/`](./docs/README.md).**

**A) Server-Env (Single-Tenant, jeder Client):** `WIKIJS_URL` + `WIKIJS_TOKEN` beim Deploy setzen → Client braucht nur die URL, keine Auth.

**B) Request-Header (Multi-Tenant, Header-fähige Clients wie Claude Code/Desktop/Cursor):**
- **Token** — `X-Wikijs-Token` → sonst `Authorization: Bearer …` → sonst Env `WIKIJS_TOKEN`.
- **Instanz-URL** — `X-Wikijs-Url` → sonst Env `WIKIJS_URL`.

**C) URL-Parameter (Multi-Tenant, für Header-lose Clients wie claude.ai-Web & ChatGPT):** persönliche Connector-URL
```
https://<deploy>/mcp?url=https://dein-wiki.example.org&token=<key-oder-alias>
```
Zusätzlich möglich: `&preset=readonly`, `&policy=<url-encodiertes-JSON>`. Echte Header haben Vorrang. (Implementiert in `app/[transport]/route.ts`, ausgewertet in `lib/context.ts`.)

So können beliebig viele Nutzer denselben Deploy mit jeweils eigenem Key und sogar **eigener Wiki.js-Instanz** verwenden.

### Optional: Alias-Map (Gateway)

Damit Clients (besonders bei Muster C) den **echten** Key nicht halten/in der URL führen müssen, kann eine Alias-Map gesetzt werden:

```bash
WIKIJS_KEY_MAP={"team-alpha":"<echter-key-1>","team-beta":"<echter-key-2>"}
```

Der Client schickt dann `Authorization: Bearer team-alpha` bzw. `?token=team-alpha`; serverseitig wird der echte Key eingesetzt.

---

## Rechtesteuerung (Permission Policy)

Jedes Tool gehört zu einer **Kategorie**. Die Policy bildet jede Kategorie (und optional jedes einzelne Tool) auf einen **Modus** ab:

| Modus | Verhalten |
|---|---|
| `allow` | wird sofort ausgeführt |
| `confirm` | gibt zunächst eine **Dry-Run-Vorschau** zurück; echte Ausführung erst mit `confirm: true` |
| `block` | wird in `tools/list` ausgeblendet (oder verweigert die Ausführung) |

**Kategorien:** `read`, `write`, `delete`, `manage_users`, `manage_groups`, `manage_system`, `manage_auth`.

### Presets (`WIKIJS_PERMISSION_PRESET`)

| Preset | read | write | delete | users | groups | system | auth |
|---|---|---|---|---|---|---|---|
| `readonly` | allow | block | block | block | block | block | block |
| `safe` *(Default)* | allow | confirm | confirm | block | block | block | block |
| `editor` | allow | allow | confirm | block | block | block | block |
| `maintainer` | allow | allow | confirm | confirm | confirm | confirm | confirm |
| `full` | allow | allow | allow | allow | allow | allow | allow |

### Feinjustierung (`WIKIJS_POLICY`, JSON)

Überschreibt das Preset pro Kategorie und/oder pro Tool:

```bash
# Seiten löschen ohne Rückfrage erlauben, Benutzerverwaltung hart blocken,
# den Raw-GraphQL-Escape-Hatch deaktivieren:
WIKIJS_POLICY={"categories":{"delete":"allow","manage_users":"block"},"tools":{"wiki_graphql":"block"}}
```

### Pro-Request verschärfen (Header)

Ein einzelner Nutzer kann sich **strenger** stellen (nie lockerer als die Server-Baseline):

```
X-Wikijs-Preset: readonly
X-Wikijs-Policy: {"categories":{"write":"confirm"}}
```

> **Sicherheitsmodell:** Der Header kann nur **verschärfen**. Was der Betreiber per Env blockt, kann kein Client per Header freischalten. Geblockte Tools sind standardmäßig unsichtbar (`WIKIJS_SHOW_BLOCKED=true` zeigt sie als deaktivierte Stubs).

---

## Tool-Übersicht

Alle Tools sind mit Präfix `wiki_` benannt. (R)=read, (W)=write, (D)=delete, (S)=manage_system, (U)=manage_users, (G)=manage_groups, (A)=manage_auth.

**Pages / Tags**
`wiki_pages_search` (R) · `wiki_page_get` (R) · `wiki_pages_list` (R) · `wiki_pages_tree` (R) · `wiki_page_history` (R) · `wiki_page_version` (R) · `wiki_pages_links` (R) · `wiki_tags_list` (R) · `wiki_tags_search` (R) · `wiki_page_create` (W) · `wiki_page_update` (W, full **oder** `edits=[{find,replace}]`) · `wiki_page_move` (W) · `wiki_page_render` (W) · `wiki_page_restore` (W) · `wiki_page_convert` (W) · `wiki_tag_update` (W) · `wiki_page_delete` (D) · `wiki_pages_delete_batch` (D, ids/paths/wildcard) · `wiki_pages_delete_tree` (D) · `wiki_tag_delete` (D) · `wiki_pages_purge_history` (D) · `wiki_pages_flush_cache` (S) · `wiki_pages_rebuild_tree` (S) · `wiki_pages_migrate_locale` (S)

**Assets** `wiki_assets_list` (R) · `wiki_asset_folders` (R) · `wiki_asset_create_folder` (W) · `wiki_asset_rename` (W) · `wiki_asset_delete` (D) · `wiki_assets_flush_temp` (S)

**Comments** `wiki_comments_list` (R) · `wiki_comment_get` (R) · `wiki_comment_create` (W) · `wiki_comment_update` (W) · `wiki_comment_delete` (D)

**Navigation** `wiki_navigation_get` (R) · `wiki_navigation_update_tree` (S)

**Users** `wiki_users_list` · `wiki_users_search` · `wiki_user_get` · `wiki_user_profile` (R) · `wiki_users_last_logins` · `wiki_user_create` · `wiki_user_update` · `wiki_user_delete` · `wiki_user_activate` · `wiki_user_deactivate` · `wiki_user_verify` · `wiki_user_reset_password` · `wiki_user_disable_tfa` (alle U außer Profile)

**Groups** `wiki_groups_list` · `wiki_group_get` · `wiki_group_create` · `wiki_group_update` (merge-sicher) · `wiki_group_delete` · `wiki_group_assign_user` · `wiki_group_unassign_user` (alle G)

**System / Auth / Escape-Hatch** `wiki_connection_status` (R) · `wiki_site_info` (R) · `wiki_site_config` (S) · `wiki_system_info` (S) · `wiki_system_flags` (S) · `wiki_apikeys_list` (A) · `wiki_apikey_create` (A) · `wiki_apikey_revoke` (A) · `wiki_auth_strategies` (A) · `wiki_auth_set_api_state` (A) · `wiki_graphql` (S, beliebige GraphQL-Operation)

---

## Architektur

```
app/[transport]/route.ts        Streamable-HTTP-Endpoint (/mcp) via mcp-handler  → Vercel
app/.well-known/mcp.json/route.ts  Discovery-Dokument
app/page.tsx                    Landing-Page (Status & Hinweise)
bin/stdio.ts                    stdio-Entry für Desktop-Clients
lib/
  meta.ts                       Servername, Version, Instructions
  context.ts                    Pro-Request-Auth + Policy-Overlay-Auflösung
  permissions.ts                Policy-Engine (Presets, allow/confirm/block, tighten-only)
  register.ts                   Zentrale Tool-Registrierung + Policy-Wrapper + Confirm-Gate
  wikijs/client.ts              fetch-basierter GraphQL-Client (ohne Extra-Dependency)
  wikijs/format.ts              Ergebnis-/Fehler-Helfer, responseResult-Prüfung
  tools/*.ts                    Tool-Definitionen je Domäne
```

**Designprinzip:** Tools sind deklarativ (`ToolDef`): Name, Kategorie, Zod-Schema, Handler. `register.ts` wendet zentral die Policy an (Hide bei `block`, Dry-Run bei `confirm`), löst pro Aufruf den Kontext auf und fängt Fehler einheitlich ab.

---

## Umgebungsvariablen

Siehe [`.env.example`](./.env.example). Kurzform:

| Variable | Pflicht | Zweck |
|---|---|---|
| `WIKIJS_URL` | stdio: ja · HTTP: optional | Basis-URL der Wiki.js-Instanz |
| `WIKIJS_TOKEN` | stdio: ja · HTTP: optional | Wiki.js-API-Key (Bearer) |
| `WIKIJS_PERMISSION_PRESET` | nein (`safe`) | Policy-Baseline |
| `WIKIJS_POLICY` | nein | JSON-Override (Kategorien/Tools) |
| `WIKIJS_SHOW_BLOCKED` | nein (`false`) | geblockte Tools als Stubs zeigen |
| `WIKIJS_KEY_MAP` | nein | Alias→echter Key (Gateway) |
| `WIKIJS_TIMEOUT_MS` | nein (`30000`) | Timeout pro GraphQL-Request |
| `PUBLIC_BASE_URL` | nein | überschreibt die URL im Discovery-Dokument |

---

## Robustheit (gelernt aus den Referenz-Implementierungen)

- **Auto-Preserve bei `wiki_page_update`:** Vor jedem Update wird die aktuelle Seite geholt; nicht angegebene Felder (content, tags, title, …) bleiben erhalten. Verhindert die bekannte Wiki.js-Falle, bei der ein Metadaten-Update (z. B. nur `isPublished`) den Inhalt löscht.
- **Request-Timeout:** Jeder GraphQL-Request bricht nach `WIKIJS_TIMEOUT_MS` (Default 30 s) per `AbortController` ab — kein hängender Serverless-Aufruf.
- **Content-Truncation:** `wiki_page_get` kürzt sehr lange Inhalte (Default 100 000 Zeichen) mit klarem Hinweis; `maxContentChars: 0` liefert den vollen Body.
- **ID-oder-Pfad:** `wiki_page_get` / `wiki_page_delete` / `wiki_page_move` akzeptieren wahlweise `id` oder `path`+`locale`.
- **Graceful Shutdown** im stdio-Modus (SIGINT/SIGTERM, EPIPE ignoriert).

## Tests

- `npm run typecheck` — TypeScript ohne Build.
- `npm run test:policy` — reine Logik-Tests der Policy-Engine (Presets, per-Tool-Override, „tighten-only").
- `npm run smoke -- http://localhost:3031/mcp` — End-to-End gegen einen laufenden Server (echter MCP-Client; prüft Handshake, Tool-Sichtbarkeit, Confirm-Gate, Header-Auth).

## Grenzen

- **Binärer Datei-Upload** von Assets läuft in Wiki.js über einen Multipart-REST-Endpoint (`/u`), **nicht** über die GraphQL-API. Da der Fokus dieses Servers (wie gewünscht) auf der GraphQL-API liegt, ist binäres Hochladen bewusst nicht enthalten — die Asset-**Verwaltung** (Ordner, Umbenennen, Löschen, Listen) ist vollständig abgedeckt. (Keine der vier Referenz-Lösungen implementiert Upload.)
- Manche Felder/Operationen verlangen in Wiki.js erhöhte Scopes (`manage:system`, `write:pages` …). Fehlt dem Key die Berechtigung, liefert Wiki.js einen Autorisierungsfehler — unabhängig von der hiesigen Policy.

---

## Lizenz

MIT
