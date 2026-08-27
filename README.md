[English](README.md) | [中文](README.zh-CN.md)

# Claude Code HUD

A 3-line, column-aligned statusline for [Claude Code](https://claude.com/claude-code). Model, context, session cache-hit rate, output speed, system load, and your 5-hour / 7-day quota — in one glanceable grid.

```
Opus 5    ⋮ xhigh     ⋮ 💭 On      ⋮ 📁 ~/projects/myapp
ctx  52%  ⋮ CH  99.2% ⋮ tok/s  164 ⋮ 5h ●●●○○ 58% ↻3h10m
cpu  33%  ⋮ mem  34%  ⋮ disk  16%  ⋮ 7d ●○○○○ 17% ↻5d3h
```

Columns 1–3 have **fixed** widths — never derived from content — so a value going from 9% to 100%, a model swap, or a longer effort level can't shove the rest of the row sideways. Column 4 is free: it holds the only genuinely variable-width content (working directory, quota rings) and sits at the right edge where drift costs nothing.

The divider is a dashed `⋮` rather than a solid `│` on purpose: stacked across three rows, a solid rule welds into one unbroken line and the HUD starts reading as a boxed table instead of three separate rows.

## What's on it

| Column | Row 1 | Row 2 | Row 3 |
|--------|-------|-------|-------|
| 1 | Model, cleaned up and color-coded by family | Context window usage | CPU utilization |
| 2 | Reasoning effort, colored by intensity | **Session cache-hit rate** | Memory usage |
| 3 | Always-thinking on/off | **Output speed** | Disk usage |
| 4 | Working directory (worktrees render as `repo:wt/name`) | 5-hour quota | 7-day quota |

**CH** is the cache-hit rate across the *whole session*: `cache_read ÷ (cache_read + cache_creation + uncached input)`. Since a high number is the good end here, its color ramp is inverted — 99% reads green.

**tok/s** is output speed over the last 5 completed requests, weighted by output size so one short reply can't swing it. Samples under a second are discarded: they describe when lines were flushed to the transcript, not how fast the model generated.

Percentages share one health palette: **<50 green · 50–75 yellow · 75–90 orange · ≥90 red**. The whole HUD follows your Claude Code theme — on `light*` themes it swaps to a dark, Flexoki-aligned ink palette so nothing washes out.

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

- **Node.js ≥ 18.15** (`statfsSync`)
- Claude Code **2.0.71+**, which puts `rate_limits` in the statusline payload. On older versions the quota column is simply absent.
- A **subscription login** (Pro/Max) for the quota column. On API-key setups those cells don't render; everything else still works.
- CPU and memory read `/proc`, so they are Linux-only. Anything unavailable is silently skipped, never an error.

## Configuration

Optional. Create `~/.claude/hud/config.json`:

```json
{
  "diskPath": "/data",
  "cols": [9, 9, 10],
  "sep": "⋮"
}
```

| Key | Default | Effect |
|-----|---------|--------|
| `diskPath` | `"/"` | Mount point measured by the `disk` cell |
| `cols` | `[9, 9, 10]` | Fixed widths of columns 1–3. Widen if your model names or labels overflow |
| `sep` | `"⋮"` | Column divider. `"┊"`, `"╎"`, `"¦"` also read well; `""` drops the dividers and aligns on padding alone |

## How it works

- Claude Code invokes the script (per `statusLine.refreshInterval`, every 2s) and pipes the session payload on stdin: model, context window, effort, thinking, cwd, and `rate_limits`. **No network calls, no credentials, no token refresh** — the quota numbers come straight from Claude Code.
- **CH** and **tok/s** are session-wide facts that stdin cannot supply — its `current_usage` describes only the latest request — so they are aggregated from the session transcript JSONL. The scan is incremental: a cache in `~/.claude/hud/.session-cache.json` holds a byte offset plus running totals, and each render parses only the bytes appended since the last one. Requests are de-duplicated by `requestId`, since one response can span several transcript records that repeat the same cumulative usage.
- Column alignment is measured, not guessed: ANSI codes are stripped and the remainder is walked as grapheme clusters, counting emoji, flags and CJK as two cells.
- CPU% is a delta between `/proc/stat` samples cached in `~/.claude/hud/.sys-cache.json`, so the first render shows `cpu —` and it settles from the second refresh on.
- **Privacy:** nothing leaves your machine. The HUD reads local files and its own stdin.

## Uninstall

```bash
./uninstall.sh
```

Removes the `statusLine` entry (only if it points at this HUD), the script, and its caches.

## License

[MIT](LICENSE)
