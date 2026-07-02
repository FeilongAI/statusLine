#!/usr/bin/env bash
# Claude Code HUD — uninstaller. Removes the statusLine entry (only if it
# points at this HUD) and deletes the installed script + caches.
set -euo pipefail

CLAUDE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
HUD_DIR="$CLAUDE_DIR/hud"
SETTINGS="$CLAUDE_DIR/settings.json"

if [ -f "$SETTINGS" ] && command -v node >/dev/null 2>&1; then
  node - "$SETTINGS" <<'NODEEOF'
const fs = require('fs');
const [settingsPath] = process.argv.slice(2);
let s;
try { s = JSON.parse(fs.readFileSync(settingsPath, 'utf8')); } catch { process.exit(0); }
const cmd = s.statusLine && s.statusLine.command;
if (typeof cmd === 'string' && cmd.includes('hud/hud.mjs')) {
  delete s.statusLine;
  fs.writeFileSync(settingsPath, JSON.stringify(s, null, 2) + '\n');
  console.log('ok: removed statusLine from ' + settingsPath);
} else {
  console.log('note: statusLine is not this HUD — leaving settings.json untouched');
}
NODEEOF
fi

rm -f "$HUD_DIR/hud.mjs" "$HUD_DIR/.usage-cache.json" "$HUD_DIR/.sys-cache.json"
echo "ok: removed $HUD_DIR/hud.mjs and caches (config.json kept, delete it manually if unwanted)"
echo "Done. Restart Claude Code to go back to the default statusline."
