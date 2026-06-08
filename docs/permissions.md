# Rechtesteuerung (Permission Policy)

Jedes Tool gehört zu einer **Kategorie**. Die Policy bildet jede Kategorie (und optional jedes einzelne Tool) auf einen **Modus** ab:

| Modus | Verhalten |
|---|---|
| `allow` | wird sofort ausgeführt |
| `confirm` | gibt zunächst eine **Dry-Run-Vorschau** zurück; echte Ausführung erst mit `confirm: true` |
| `block` | wird in `tools/list` ausgeblendet (oder verweigert die Ausführung) |

**Kategorien:** `read`, `write`, `delete`, `manage_users`, `manage_groups`, `manage_system`, `manage_auth`.

## Zwei Ebenen
1. **Deploy-Baseline (Env):** entscheidet, welche Tools überhaupt **registriert/sichtbar** sind. Geblockte Kategorien sind in `tools/list` unsichtbar (außer `WIKIJS_SHOW_BLOCKED=true`).
2. **Pro-Request-Overlay (Header/URL):** kann pro Nutzer nur **verschärfen** (Call-Time). Was die Baseline blockt, kann ein Client nie freischalten.

> Strenge-Reihenfolge: `block` > `confirm` > `allow`. Effektiver Modus = strengster aus (Baseline, Overlay).

## Presets (`WIKIJS_PERMISSION_PRESET`)

| Preset | read | write | delete | users | groups | system | auth |
|---|---|---|---|---|---|---|---|
| `readonly` | allow | block | block | block | block | block | block |
| `safe` *(Default)* | allow | confirm | confirm | block | block | block | block |
| `editor` | allow | allow | confirm | block | block | block | block |
| `maintainer` | allow | allow | confirm | confirm | confirm | confirm | confirm |
| `full` | allow | allow | allow | allow | allow | allow | allow |

## Feinjustierung per Env (`WIKIJS_POLICY`, JSON)
Überschreibt das Preset pro Kategorie und/oder pro Tool:
```bash
WIKIJS_POLICY={"categories":{"delete":"allow","manage_users":"block"},"tools":{"wiki_graphql":"block"}}
```

## Pro-Request verschärfen
- **Header** (Claude Code/Desktop/Cursor): `X-Wikijs-Preset: readonly` und/oder `X-Wikijs-Policy: {"categories":{"write":"confirm"}}`
- **URL** (claude.ai-Web/ChatGPT): `…/mcp?...&preset=readonly` und/oder `&policy=<url-encodiertes-JSON>`

## Beispiel-Setups
| Ziel | Env |
|---|---|
| Nur lesen | `WIKIJS_PERMISSION_PRESET=readonly` |
| Redaktion (lesen+schreiben, löschen mit Rückfrage) | `WIKIJS_PERMISSION_PRESET=editor` |
| Voll-Admin, aber alles Heikle mit Rückfrage | `WIKIJS_PERMISSION_PRESET=maintainer` |
| Vertrauen auf die Key-Rechte in Wiki.js | `WIKIJS_PERMISSION_PRESET=full` |

## Testen
`npm run test:policy` prüft die Auflösungslogik (Presets, Per-Tool-Override, „tighten-only") ohne Netzwerk.
