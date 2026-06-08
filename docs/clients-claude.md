# Client-Einrichtung: Claude

Voraussetzung: Der Server ist auf Vercel deployt → Endpoint `https://<deploy>/mcp`. (Lokal: `npm run dev` → `http://localhost:3030/mcp`.)

Zur Erinnerung die [3 Auth-Muster](./README.md#das-wichtigste-zuerst-die-3-wege-zugangsdaten-zu-übergeben): **A** = Server-Env, **B** = Header, **C** = URL-Parameter.

---

## 1. Claude Code (CLI) — Muster B (eigener Key pro User via Header) ✅

Claude Code unterstützt Custom-Header für Remote-MCP-Server. Das ist der direkteste Weg für „jeder User seinen eigenen Key".

```bash
claude mcp add --transport http wikijs https://<deploy>/mcp \
  --header "X-Wikijs-Url: https://dein-wiki.example.org" \
  --header "Authorization: Bearer DEIN_WIKIJS_API_KEY"
```

- Mehrere `--header` sind erlaubt. Statt `Authorization: Bearer …` geht auch `--header "X-Wikijs-Token: DEIN_KEY"`.
- Scope wählen: `-s local` (nur du, dieses Projekt – Default), `-s project` (ins eingecheckte `.mcp.json`, **ohne** echten Key committen!), `-s user` (alle deine Projekte).
- Prüfen: `claude mcp list` und `claude mcp get wikijs`.

Optional eine eigene, strengere Policy nur für dich:
```bash
  --header "X-Wikijs-Preset: editor"
```

### Alternativ als JSON (`~/.claude.json` oder Projekt-`.mcp.json`)
```jsonc
{
  "mcpServers": {
    "wikijs": {
      "type": "http",
      "url": "https://<deploy>/mcp",
      "headers": {
        "X-Wikijs-Url": "https://dein-wiki.example.org",
        "Authorization": "Bearer DEIN_WIKIJS_API_KEY"
      }
    }
  }
}
```

---

## 2. Claude Code Web / claude.ai-Connector — Muster C oder A

Die **Connector-Oberfläche** auf claude.ai (Web/Desktop) erlaubt aktuell **keine** Custom-Header — nur OAuth oder eine reine URL. Darum hier **Muster C (persönliche URL)** oder **Muster A (Single-Tenant)**.

> Voraussetzung: Plan **Pro, Max, Team oder Enterprise** (bei Team/Enterprise nur durch Owner). Der Server muss öffentlich aus dem Internet erreichbar sein (Vercel ✓).

**Schritte:**
1. claude.ai öffnen → **Settings → Connectors → Add custom connector**.
2. **Name**: z. B. `Wiki.js`.
3. **Remote MCP server URL** eintragen:
   - **Muster C (eigener Key pro User):**
     ```
     https://<deploy>/mcp?url=https://dein-wiki.example.org&token=DEIN_KEY_ODER_ALIAS
     ```
     Empfehlung: `token=` auf einen **Alias** setzen (echter Key serverseitig via `WIKIJS_KEY_MAP`), damit der echte Key nicht in der URL steht.
   - **Muster A (Single-Tenant):** wenn der Deploy `WIKIJS_URL` + `WIKIJS_TOKEN` als Env gesetzt hat, genügt:
     ```
     https://<deploy>/mcp
     ```
4. **Advanced settings** kannst du leer lassen (OAuth wird hier nicht gebraucht).
5. **Add** klicken → im Chat über das Werkzeug-/Connector-Menü aktivieren.

> Wenn du die Policy pro Nutzer verschärfen willst, hänge `&preset=readonly` (oder `editor`, …) an die URL.

---

## 3. Claude Desktop — Muster B (lokal, stdio) ✅

Für den lokalen Betrieb am eigenen Rechner ist **stdio** am robustesten (kein Deploy nötig). Config-Datei:
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

```jsonc
{
  "mcpServers": {
    "wikijs": {
      "command": "npm",
      "args": ["--prefix", "/ABSOLUTER/PFAD/zu/mcp-wikijs-mv", "run", "stdio"],
      "env": {
        "WIKIJS_URL": "https://dein-wiki.example.org",
        "WIKIJS_TOKEN": "DEIN_WIKIJS_API_KEY",
        "WIKIJS_PERMISSION_PRESET": "editor"
      }
    }
  }
}
```
Danach Claude Desktop neu starten. (Für einen **Remote**-Server in Claude Desktop gilt dieselbe Connector-Oberfläche wie unter 2.)

---

## 4. Cursor — Muster B (Header) ✅

`.cursor/mcp.json` (im Projekt) oder global:
```jsonc
{
  "mcpServers": {
    "wikijs": {
      "url": "https://<deploy>/mcp",
      "headers": {
        "X-Wikijs-Url": "https://dein-wiki.example.org",
        "X-Wikijs-Token": "DEIN_WIKIJS_API_KEY"
      }
    }
  }
}
```
Oder lokal per stdio analog zu Claude Desktop (`command`/`args`/`env`).

---

## Test
Nach dem Einrichten in den Chat tippen: *„Liste die Tools des wikijs-Servers"* bzw. das Tool **`wiki_connection_status`** aufrufen lassen — es zeigt, ob Verbindung und Key stimmen.
