---
name: setup
description: Point Claude Code's statusLine at the HUD — copies hud.mjs to ~/.claude/hud/ and backs up settings.json first.
disable-model-invocation: true
---

Install the Claude Code HUD statusline.

1. Read `settings.json` in `$CLAUDE_CONFIG_DIR` (default `~/.claude`). If it already has a `statusLine` whose `command` does not contain `hud/hud.mjs`, show the user that entry and ask whether to replace it. Stop if they say no.
2. Run `bash "${CLAUDE_PLUGIN_ROOT}/install.sh"`. It checks for Node.js ≥ 18.15, copies `hud.mjs` to `~/.claude/hud/`, backs up `settings.json`, and writes the `statusLine` entry.
3. Relay the script's output. Tell the user the HUD shows up in the next session (or after restarting Claude Code), and that from now on the plugin refreshes `~/.claude/hud/hud.mjs` at every session start, so `/plugin update` is all an upgrade takes. Settings go in `~/.claude/hud/config.json` (see the README); edits to the script itself are overwritten.
