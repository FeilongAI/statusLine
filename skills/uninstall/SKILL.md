---
name: uninstall
description: Remove the HUD's statusLine entry, script and caches. Run before /plugin uninstall.
disable-model-invocation: true
---

Run `bash "${CLAUDE_PLUGIN_ROOT}/uninstall.sh"` and relay its output. It removes the `statusLine` entry only if it points at this HUD, then deletes `~/.claude/hud/hud.mjs` and its caches (`config.json` is kept).

Then tell the user to finish with `/plugin uninstall claude-code-hud@claude-code-hud`. Until they do, the plugin's session-start hook stays idle: it only refreshes a `hud.mjs` that already exists.
