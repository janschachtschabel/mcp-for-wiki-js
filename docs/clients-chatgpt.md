# Client-Einrichtung: ChatGPT

ChatGPT bindet eigene MCP-Server über **Developer Mode → Custom Connectors** ein. Diese unterstützen **kein** Custom-Header-Auth — daher nutzt du hier **Muster C (URL-Parameter)** oder **Muster A (Single-Tenant-Env)**. Siehe die [3 Auth-Muster](./README.md#das-wichtigste-zuerst-die-3-wege-zugangsdaten-zu-übergeben).

> Voraussetzungen: Plan **Plus, Pro, Business, Enterprise oder Edu**. Der MCP-Server muss über **HTTPS** öffentlich erreichbar sein (Vercel ✓). Developer Mode gibt MCP-Clients **volle** Tool-Unterstützung inkl. Schreib-Aktionen (mit Bestätigungs-Dialogen) — entsprechend vorsichtig die Policy wählen.

---

## Schritt 1 — Developer Mode aktivieren
In ChatGPT (Web):
- **Settings → Connectors → Advanced settings → Developer mode** einschalten.
  (Bei Business/Enterprise ggf. unter **Workspace Settings → Permissions & Roles → Connected Data / Custom MCP connectors** durch Admin freischalten.)

## Schritt 2 — Custom Connector anlegen
1. **Settings → Connectors → Create** (bzw. „Add custom connector").
2. **Name**: `Wiki.js`.
3. **MCP Server URL**:
   - **Muster C (eigener Key pro User):**
     ```
     https://<deploy>/mcp?url=https://dein-wiki.example.org&token=DEIN_KEY_ODER_ALIAS
     ```
     **Empfohlen:** `token=` = **Alias** (echter Key serverseitig via `WIKIJS_KEY_MAP`), damit der echte Key nicht in der URL/History landet. Optional `&preset=readonly` zum Verschärfen.
   - **Muster A (Single-Tenant):** Deploy hat `WIKIJS_URL` + `WIKIJS_TOKEN` als Env → einfach:
     ```
     https://<deploy>/mcp
     ```
4. **Authentication**: **No authentication** wählen (die Zugangsdaten stecken in der URL bzw. im Server-Env).
5. Speichern/„Create".

## Schritt 3 — Im Chat nutzen
Im Composer das **Connector-/Developer-Mode-Menü** öffnen, `Wiki.js` aktivieren. Dann z. B.: *„Nutze wiki_pages_search nach 'Onboarding'"* oder *„Rufe wiki_connection_status auf"* zur Verbindungsprüfung.

---

## Hinweise
- **Schreib-Aktionen:** ChatGPT zeigt vor Write-Tools einen Bestätigungs-Dialog. Zusätzlich greift die Server-Policy: im Default-Preset `safe` liefern Write/Delete-Tools zuerst eine **Dry-Run-Vorschau** und führen erst mit `confirm: true` aus. Für ein reines Lese-Setup `&preset=readonly` an die URL hängen.
- **`/sse` vs `/mcp`:** Ältere ChatGPT-Anleitungen nennen einen `/sse`-Endpoint. Dieser Server nutzt bewusst **Streamable HTTP** unter `/mcp` (SSE deaktiviert, kein Redis nötig) — das ist der von ChatGPT Developer Mode unterstützte moderne Transport. Immer die `/mcp`-URL eintragen.
- **OAuth:** Wird hier nicht benötigt. (Eine echte OAuth-Anbindung wäre eine separate Ausbaustufe, falls du Keys gar nicht über die URL geben willst.)

## Quellen (Stand der Recherche)
- OpenAI Help Center: „Developer mode — apps and full MCP connectors in ChatGPT" — https://help.openai.com/en/articles/12584461-developer-mode-apps-and-full-mcp-connectors-in-chatgpt-beta
- OpenAI Developers: „Building MCP servers for ChatGPT" — https://developers.openai.com/api/docs/mcp
