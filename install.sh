#!/usr/bin/env bash
# Claude Code HUD — one-line installer.
#   curl -fsSL https://raw.githubusercontent.com/FeilongAI/statusLine/main/install.sh | bash
# or, from a clone:
#   ./install.sh
set -euo pipefail

REPO_RAW="https://raw.githubusercontent.com/FeilongAI/statusLine/main"
CLAUDE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
HUD_DIR="$CLAUDE_DIR/hud"
SETTINGS="$CLAUDE_DIR/settings.json"

# ── 1. Node.js check (needs >=18.15 for statfsSync) ──
if ! command -v node >/dev/null 2>&1; then
  echo "error: Node.js not found. The HUD needs Node.js v18.15+ — https://nodejs.org" >&2
  exit 1
fi
if ! node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>18||(a===18&&b>=15)?0:1)'; then
  echo "error: Node.js v18.15+ required, found $(node --version)" >&2
  exit 1
fi

# ── 2. Install hud.mjs ──
mkdir -p "$HUD_DIR"
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-/nonexistent}")" 2>/dev/null && pwd || true)"
if [ -n "$SRC_DIR" ] && [ -f "$SRC_DIR/hud.mjs" ]; then
  cp "$SRC_DIR/hud.mjs" "$HUD_DIR/hud.mjs"
  echo "ok: copied hud.mjs -> $HUD_DIR/hud.mjs"
else
  curl -fsSL "$REPO_RAW/hud.mjs" -o "$HUD_DIR/hud.mjs"
  echo "ok: downloaded hud.mjs -> $HUD_DIR/hud.mjs"
fi

# ── 3. Point statusLine at the HUD (backing up settings.json first) ──
if [ -f "$SETTINGS" ]; then
  BACKUP="$SETTINGS.bak.hud.$(date +%Y%m%d-%H%M%S)"
  cp "$SETTINGS" "$BACKUP"
  echo "ok: backed up settings.json -> $BACKUP"
fi

node - "$SETTINGS" "$HUD_DIR/hud.mjs" <<'NODEEOF'
const fs = require('fs');
const path = require('path');
const [settingsPath, hudPathAbs] = process.argv.slice(2);

let s = {};
try { s = JSON.parse(fs.readFileSync(settingsPath, 'utf8')); } catch { /* fresh file */ }

if (s.statusLine) {
  console.log('note: replacing existing statusLine: ' + JSON.stringify(s.statusLine));
}

// Prefer a "~"-relative path so dotfile syncing across machines keeps working.
const home = process.env.HOME || '';
const hudPath = home && hudPathAbs.startsWith(home + '/')
  ? '~' + hudPathAbs.slice(home.length)
  : hudPathAbs;

s.statusLine = { type: 'command', command: `node ${hudPath}`, refreshInterval: 2 };

fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
fs.writeFileSync(settingsPath, JSON.stringify(s, null, 2) + '\n');
console.log('ok: statusLine configured in ' + settingsPath);
NODEEOF

echo ""
echo "Done. Restart Claude Code (or start a new session) to see the HUD."
echo "Optional per-user config: $HUD_DIR/config.json  (see README)"
