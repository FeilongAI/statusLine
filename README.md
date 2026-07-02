[English](README.md) | [中文](README.zh-CN.md)

# Claude Code HUD

A 2-line statusline for [Claude Code](https://claude.com/claude-code) that packs model, context, effort, system load, and your 5-hour / 7-day usage quota into one glanceable heads-up display.

```
🇯🇵 Opus 4.8 · v2.0.14 · ctx 52% · 💭 On · effort xhigh · 📁 ~/projects/myapp
cpu 32% · mem 37% · disk 11% · 5h ●●●○○ 58% ↻3h10m · 7d ●○○○○ 17% ↻5d3h
```

Every item is separated by a dim `·`, and the two lines are laid out independently — no column alignment, so emoji width differences can never misalign anything.

## What's on it

| Line 1 | Meaning |
|--------|---------|
| `🇯🇵` | Optional flag/emoji prefix (off by default, see [Configuration](#configuration)) |
| `Opus 4.8` | Current model, cleaned up (`Claude ` prefix, `(1M context)` / `[1m]` tails stripped), color-coded by family |
| `v2.0.14` | Claude Code version |
| `ctx 52%` | Context window usage, health-tinted |
| `💭 On` | Always-thinking mode on/off |
| `effort xhigh` | Reasoning effort level, color ramps with intensity |
| `📁 ~/path` | Working directory, smart-shortened (git worktrees render as `repo:wt/name`) |

| Line 2 | Meaning |
|--------|---------|
| `cpu 32%` | CPU utilization (Linux only) |
| `mem 37%` | Memory usage (Linux only) |
| `disk 11%` | Disk usage of a configurable mount (all platforms) |
| `5h ●●●○○ 58% ↻3h10m` | 5-hour quota: progress ring, percent, countdown to reset |
| `7d ●○○○○ 17% ↻5d3h` | Same for the 7-day quota |

All percentages share one health palette: **<50 green · 50–75 yellow · 75–90 orange · ≥90 red**. The whole HUD also adapts to your Claude Code theme — on `light*` themes it swaps to a dark, Flexoki-aligned ink palette so nothing washes out.

## Install

**One-liner:**

```bash
curl -fsSL https://raw.githubusercontent.com/yang1997434/claude-code-hud/main/install.sh | bash
```

**Or from a clone:**

```bash
git clone https://github.com/yang1997434/claude-code-hud.git
cd claude-code-hud && ./install.sh
```

**Or just ask your Claude** — paste this into Claude Code:

> Install the statusline from https://github.com/yang1997434/claude-code-hud : fetch its install.sh and run it, then confirm the statusLine entry in ~/.claude/settings.json.

The installer copies `hud.mjs` to `~/.claude/hud/`, backs up your `settings.json`, and points `statusLine` at the script. Restart Claude Code and the HUD appears.

### Requirements

- **Node.js ≥ 18.15** (global `fetch` + `statfsSync`)
- Claude Code with a **subscription login** (Pro/Max) for the quota segments — they read the same usage API the CLI itself uses. On API-key setups the quota segments simply don't render; everything else still works.
- Quota + cpu/mem segments degrade gracefully: anything unavailable is silently skipped, never an error.

## Configuration

Optional. Create `~/.claude/hud/config.json`:

```json
{
  "flag": "🇯🇵",
  "diskPath": "/data"
}
```

| Key | Default | Effect |
|-----|---------|--------|
| `flag` | `""` (hidden) | Emoji/text prefix shown before the model name — a region flag, a hostname tag, anything |
| `diskPath` | `"/"` | Mount point measured by the `disk` segment |

## How it works

- Claude Code invokes the script (per `statusLine.refreshInterval`, every 2s) and pipes session JSON — model, version, context window, effort, cwd — on stdin.
- Quota comes from Anthropic's OAuth usage endpoint (`api.anthropic.com/api/oauth/usage`), authenticated with your existing Claude Code credentials: `CLAUDE_CODE_OAUTH_TOKEN` env, macOS Keychain, or `~/.claude/.credentials.json`, in that order. Expired tokens are refreshed against `platform.claude.com`. Responses are cached for 60s in `~/.claude/hud/.usage-cache.json`, and the last good data is kept on transient errors so the row never flickers empty.
- **Privacy:** your token is only ever sent to those two official Anthropic endpoints. Nothing else leaves your machine.
- CPU% is a delta between `/proc/stat` samples cached in `~/.claude/hud/.sys-cache.json`, so the first render shows `cpu —` and it settles from the second refresh on.

## Uninstall

```bash
./uninstall.sh
```

Removes the `statusLine` entry (only if it points at this HUD), the script, and its caches.

## License

[MIT](LICENSE)
