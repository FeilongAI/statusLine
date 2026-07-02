#!/usr/bin/env node
/**
 * Claude Code HUD — a 2-line statusline for Claude Code.
 *
 * Line 1: 🇯🇵 Opus 4.8 · v2.0.14 · ctx 52% · 💭 On · effort xhigh · 📁 ~/path
 * Line 2: cpu 32% · mem 37% · disk 11% · 5h ●●●○○ 58% ↻3h10m · 7d ●○○○○ 17% ↻5d3h
 *
 * Every item is separated by a dim "·". Both lines are independent — no
 * column alignment, so emoji width differences can never misalign anything.
 *
 * Design notes:
 *  - Model name is cleaned to "Opus 4.8": strips a leading "Claude ", a trailing
 *    "(1M context)" parenthetical, and a "[1m]" bracket variant.
 *  - thinking / cwd use an icon (💭 / 📁); the rest use short text labels.
 *    ctx / cpu / mem / disk are health-tinted; mem/disk show % only. 5h/7d show a
 *    5-circle progress ring (<50 green · 50-75 yellow · 75-90 orange · ≥90 red).
 *  - cpu/mem read /proc and only render on Linux; disk works everywhere.
 *  - Follows the Claude Code theme: on light themes a dark, Flexoki-aligned
 *    palette replaces the dark-terminal colors that would wash out on paper.
 *  - Optional config: ~/.claude/hud/config.json — see README.
 */

import { readFileSync, writeFileSync, statfsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';

const VERSION = '1.0.0';

const HOME = homedir();
const HUD_DIR = join(HOME, '.claude', 'hud');
const CACHE_PATH = join(HUD_DIR, '.usage-cache.json');
const SYS_CACHE_PATH = join(HUD_DIR, '.sys-cache.json');
const CACHE_TTL = 60_000;
const CACHE_TTL_ERR = 30_000;
// Claude Code's public OAuth client id (same one the CLI itself uses).
const OAUTH_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';

// ── User config (all optional) ──────────────────────
// ~/.claude/hud/config.json:
//   { "flag": "🇯🇵", "diskPath": "/data" }
function loadConfig() {
  try {
    return JSON.parse(readFileSync(join(HUD_DIR, 'config.json'), 'utf8'));
  } catch { return {}; }
}
const CFG = loadConfig();
const FLAG = typeof CFG.flag === 'string' ? CFG.flag : '';
const DISK_PATH = typeof CFG.diskPath === 'string' ? CFG.diskPath : '/';

// Only two labels read better as icons; the rest stay as short text.
const EMO = {
  think: '💭',  // thinking mode
  cwd:   '📁',  // working directory
};

// ── Theme-aware palette ─────────────────────────────
// The HUD palette follows the Claude Code theme (settings.theme). The base
// colors are tuned for a dark terminal; on a light background the pale text
// would wash out to an unreadable grey, so "light*" themes swap in a dark,
// Flexoki-aligned palette built for paper-like backgrounds.
const rgb = (r, g, b) => `\x1b[38;2;${r};${g};${b}m`;

function detectLightBg() {
  try {
    const s = JSON.parse(readFileSync(join(HOME, '.claude', 'settings.json'), 'utf8'));
    return typeof s.theme === 'string' && s.theme.startsWith('light');
  } catch { return false; }
}
const LIGHT_BG = detectLightBg();

const C = LIGHT_BG ? {
  // Light-bg palette — dark, saturated inks (mostly Flexoki 600) for warm paper.
  reset:   '\x1b[0m',
  dim:     '\x1b[2m',
  bold:    '\x1b[1m',
  blue:    rgb(32, 94, 166),
  orange:  rgb(188, 82, 21),
  green:   rgb(30, 120, 40),
  cyan:    rgb(36, 131, 123),
  red:     rgb(175, 48, 41),
  yellow:  rgb(173, 131, 1),
  magenta: rgb(94, 64, 157),
  white:   rgb(64, 62, 55),     // primary label / detail text
  gray:    rgb(111, 110, 105),
  dimGray: rgb(183, 181, 172),  // placeholders — muted but visible
  bGreen:  rgb(22, 100, 32),
  bYellow: rgb(142, 107, 1),
  bRed:    rgb(148, 40, 34),
  bOrange: rgb(157, 67, 16),
} : {
  // Dark-bg palette — tuned for dark terminals.
  reset:   '\x1b[0m',
  dim:     '\x1b[2m',
  bold:    '\x1b[1m',
  blue:    rgb(0, 153, 255),
  orange:  rgb(255, 176, 85),
  green:   rgb(0, 160, 0),
  cyan:    rgb(46, 149, 153),
  red:     rgb(255, 85, 85),
  yellow:  rgb(230, 200, 0),
  magenta: rgb(200, 100, 255),
  white:   rgb(220, 220, 220),
  gray:    rgb(128, 128, 128),
  dimGray: rgb(80, 80, 80),
  bGreen:  rgb(0, 200, 0),
  bYellow: rgb(255, 220, 0),
  bRed:    rgb(255, 70, 70),
  bOrange: rgb(255, 160, 60),
};

// Item separator — a dim "·" between every item, uniform across both lines.
const DOT = ` ${C.dim}·${C.reset} `;

// ── Stdin ───────────────────────────────────────────
async function readStdin() {
  if (process.stdin.isTTY) return null;
  const chunks = [];
  try {
    process.stdin.setEncoding('utf8');
    for await (const chunk of process.stdin) chunks.push(chunk);
    const raw = chunks.join('');
    if (!raw.trim()) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

// ── Helpers ─────────────────────────────────────────
// One shared "percentage health" palette — ctx / cpu / mem / disk / quota all
// use the same thresholds: <50 green, 50–75 yellow, 75–90 orange, ≥90 red.
// Orange/red are reserved for "approaching the limit" warnings.
function healthColor(pct) {
  if (pct >= 90) return C.red;
  if (pct >= 75) return C.orange;
  if (pct >= 50) return C.yellow;
  return C.green;
}

// Reset time as a pure relative countdown, no leading-zero units:
//   <1h → "25m" · <24h → "3h10m" · ≥24h → "5d3h" (days + hours, minutes dropped)
function fmtResetRelative(isoStr) {
  if (!isoStr) return '';
  const reset = new Date(isoStr);
  if (isNaN(reset.getTime())) return '';
  const diffMs = reset.getTime() - Date.now();
  if (diffMs <= 0) return 'now';

  const totalMin = Math.floor(diffMs / 60_000);
  const hours = Math.floor(totalMin / 60);
  const mins = totalMin % 60;

  if (hours < 1) return `${mins}m`;
  if (hours < 24) return `${hours}h${String(mins).padStart(2, '0')}m`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours > 0 ? `${days}d${remHours}h` : `${days}d`;
}

// 5-circle progress ring: filled = round(pct/20), empty rings as base.
function quotaCircles(pct) {
  const clamped = Math.min(100, Math.max(0, pct));
  const full = Math.round(clamped / 20);
  const clr = healthColor(clamped);
  return `${clr}${'●'.repeat(full)}${C.dimGray}${'○'.repeat(5 - full)}${C.reset}`;
}

// Render one quota bucket with rings: "5h ●●○○○ 58% ↻3h10m"
function quotaSeg(label, bucket) {
  if (!bucket || typeof bucket.utilization !== 'number') return '';
  const pct = Math.round(bucket.utilization);
  const clr = healthColor(pct);
  const reset = fmtResetRelative(bucket.resets_at);
  const resetStr = reset ? ` ${C.gray}↻${reset}${C.reset}` : '';
  return `${C.white}${label} ${C.reset}${quotaCircles(pct)} ${clr}${pct}%${C.reset}${resetStr}`;
}

// ── System Stats (CPU / Mem / Disk) ──────────────────
// CPU% needs a delta between two /proc/stat samples, so we cache the
// previous snapshot. First invocation returns null; subsequent runs
// (triggered by refreshInterval) compute a real utilization %.
function readProcStat() {
  try {
    const line = readFileSync('/proc/stat', 'utf8').split('\n', 1)[0];
    const parts = line.trim().split(/\s+/).slice(1).map(Number);
    const [user = 0, nice = 0, system = 0, idle = 0, iowait = 0, irq = 0, softirq = 0, steal = 0] = parts;
    const total = user + nice + system + idle + iowait + irq + softirq + steal;
    const idleTotal = idle + iowait;
    return { total, idle: idleTotal, ts: Date.now() };
  } catch { return null; }
}

function getCpuStats() {
  const now = readProcStat();
  if (!now) return null;  // non-Linux: no /proc/stat → segment is skipped

  let pct = null;
  try {
    const prev = JSON.parse(readFileSync(SYS_CACHE_PATH, 'utf8'));
    // Only trust the delta if the previous sample is recent — stale
    // snapshots across hibernation or long idle would skew the average.
    if (prev?.cpu && (now.ts - prev.cpu.ts) < 30_000) {
      const totalDiff = now.total - prev.cpu.total;
      const idleDiff = now.idle - prev.cpu.idle;
      if (totalDiff > 0) {
        pct = Math.max(0, Math.min(100, Math.round((1 - idleDiff / totalDiff) * 100)));
      }
    }
  } catch { /* first run */ }

  try {
    let cache = {};
    try { cache = JSON.parse(readFileSync(SYS_CACHE_PATH, 'utf8')); } catch { /* ignore */ }
    cache.cpu = now;
    writeFileSync(SYS_CACHE_PATH, JSON.stringify(cache));
  } catch { /* ignore */ }

  return { pct };
}

function getMemStats() {
  try {
    const raw = readFileSync('/proc/meminfo', 'utf8');
    const pick = (key) => {
      const m = raw.match(new RegExp(`^${key}:\\s+(\\d+)\\s*kB`, 'm'));
      return m ? parseInt(m[1], 10) * 1024 : null;
    };
    const total = pick('MemTotal');
    const available = pick('MemAvailable');
    if (!total || available == null) return null;
    const used = total - available;
    return { total, used, pct: Math.round((used / total) * 100) };
  } catch { return null; }
}

function getDiskStats(path) {
  try {
    const s = statfsSync(path);
    const total = Number(s.blocks) * Number(s.bsize);
    const free = Number(s.bavail) * Number(s.bsize);
    if (!total) return null;
    const used = total - free;
    return { total, used, pct: Math.round((used / total) * 100) };
  } catch { return null; }
}

// cpu: percent only, tinted by health. "cpu 32%"
function cpuSegment(cpu) {
  if (cpu.pct == null) {
    return `${C.white}cpu ${C.reset}${C.dim}—${C.reset}`;  // bootstrap: no prior sample yet
  }
  return `${C.white}cpu ${C.reset}${healthColor(cpu.pct)}${cpu.pct}%${C.reset}`;
}

// mem / disk: percent only, tinted by usage% (keeps the "almost full" warning).
// "mem 37%"
function usageSegment(label, s) {
  if (!s) return '';
  return `${C.white}${label} ${C.reset}${healthColor(s.pct)}${s.pct}%${C.reset}`;
}

// ── CWD Formatting ───────────────────────────────────
// Cap the cwd so a long worktree path doesn't blow out line 1.
const CWD_MAX = 24;

function fmtCwd(cwd) {
  if (!cwd) return '';
  const home = HOME;
  let p = cwd.startsWith(home) ? '~' + cwd.slice(home.length) : cwd;

  // Worktree shorthand: ".../<repo>/.claude/worktrees/<id>" → "<repo>:wt/<id>"
  const wtMatch = p.match(/^(.*?)\/\.claude\/worktrees\/([^/]+)$/);
  if (wtMatch) {
    const repo = wtMatch[1].split('/').pop() || wtMatch[1];
    p = `${repo}:wt/${wtMatch[2]}`;
  }

  if (p.length <= CWD_MAX) return p;

  // Generic mid-elision: keep first segment + "…" + last 2 segments.
  const segs = p.split('/').filter(Boolean);
  if (segs.length >= 4) {
    const lead = p.startsWith('/') ? '/' : (p.startsWith('~') ? '~/' : '');
    const head = p.startsWith('~') ? '' : segs[0];
    const tail = segs.slice(-2).join('/');
    const candidate = `${lead}${head}${head ? '/' : ''}…/${tail}`;
    if (candidate.length <= CWD_MAX) return candidate;
  }

  // Last resort: hard truncate from the left, keep the meaningful tail.
  return '…' + p.slice(p.length - (CWD_MAX - 1));
}

// ── Credentials ─────────────────────────────────────
function getCredentials() {
  const envToken = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  if (envToken) return { accessToken: envToken };

  if (platform() === 'darwin') {
    try {
      const raw = execSync(
        '/usr/bin/security find-generic-password -s "Claude Code-credentials" -w',
        { encoding: 'utf8', timeout: 2000, stdio: ['pipe', 'pipe', 'pipe'] }
      ).trim();
      const parsed = JSON.parse(raw);
      return parsed.claudeAiOauth || parsed;
    } catch { /* fall through */ }
  }

  try {
    const raw = readFileSync(join(HOME, '.claude', '.credentials.json'), 'utf8');
    const parsed = JSON.parse(raw);
    return parsed.claudeAiOauth || parsed;
  } catch { return null; }
}

async function refreshAccessToken(refreshToken) {
  const res = await fetch('https://platform.claude.com/v1/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}&client_id=${OAUTH_CLIENT_ID}`,
    signal: AbortSignal.timeout(3000),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.access_token || null;
}

// ── Usage API ───────────────────────────────────────
function readCache() {
  try {
    const cache = JSON.parse(readFileSync(CACHE_PATH, 'utf8'));
    const age = Date.now() - (cache.timestamp || 0);
    const ttl = cache.error ? CACHE_TTL_ERR : CACHE_TTL;
    return { data: cache.data, fresh: age < ttl };
  } catch {
    return { data: null, fresh: false };
  }
}

function writeCache(data, error = false) {
  try {
    // On error, preserve the last successful data so the quota row doesn't
    // briefly render with empty columns while retries are in-flight.
    let finalData = data;
    if (error) {
      try {
        const prev = JSON.parse(readFileSync(CACHE_PATH, 'utf8'));
        if (prev?.data) finalData = prev.data;
      } catch { /* no prior cache */ }
    }
    writeFileSync(CACHE_PATH, JSON.stringify({
      timestamp: Date.now(),
      data: finalData,
      error,
      source: 'anthropic',
    }));
  } catch { /* ignore */ }
}

async function fetchUsageWithToken(token) {
  const res = await fetch('https://api.anthropic.com/api/oauth/usage', {
    headers: {
      'Authorization': `Bearer ${token}`,
      'anthropic-beta': 'oauth-2025-04-20',
    },
    signal: AbortSignal.timeout(3000),
  });
  return res;
}

async function fetchUsage() {
  const cache = readCache();
  if (cache.fresh && cache.data) return cache.data;

  try {
    const creds = getCredentials();
    if (!creds?.accessToken) {
      writeCache(null, true);
      return cache.data;
    }

    let token = creds.accessToken;

    // Proactively refresh if we know token is expired
    if (creds.expiresAt && Date.now() > creds.expiresAt && creds.refreshToken) {
      const newToken = await refreshAccessToken(creds.refreshToken);
      if (newToken) token = newToken;
    }

    let res = await fetchUsageWithToken(token);

    // If 401 (expired token), try refreshing and retry once
    if (res.status === 401 && creds.refreshToken) {
      const newToken = await refreshAccessToken(creds.refreshToken);
      if (newToken) {
        res = await fetchUsageWithToken(newToken);
      }
    }

    if (!res.ok) {
      writeCache(null, true);
      return cache.data;
    }

    const data = await res.json();
    writeCache(data);
    return data;
  } catch {
    writeCache(null, true);
    return cache.data;
  }
}

function readSettings() {
  try {
    return JSON.parse(readFileSync(join(HOME, '.claude', 'settings.json'), 'utf8'));
  } catch { return {}; }
}

// ══════════════════════════════════════════════════════
// Build 2 dot-separated lines
//   Line 1: [flag] model · version · ctx · thinking · effort · cwd
//   Line 2: cpu · mem · disk · 5h · 7d
// ══════════════════════════════════════════════════════

function buildLines(stdin, usage) {
  const settings = readSettings();

  const cpu = getCpuStats();
  const mem = getMemStats();
  const disk = getDiskStats(DISK_PATH);

  // ── model name → "Opus 4.8" (strip "Claude ", "(1M context)", "[1m]") ──
  const id = stdin.model?.id ?? '';
  const display = stdin.model?.display_name ?? '';
  const name = (display || id.replace('claude-', '').replace(/-\d{8}$/, ''))
    .replace(/^claude\s+/i, '')        // "Claude Opus 4.8" → "Opus 4.8"
    .replace(/\s*\([^)]*\)\s*$/, '')   // strip "(1M context)" tail
    .replace(/\s*\[[^\]]*\]\s*$/, '')  // strip "[1m]" variant tail
    .trim();
  let modelColor = C.cyan;
  if (/opus/i.test(id)) modelColor = C.magenta;
  else if (/sonnet/i.test(id)) modelColor = C.cyan;
  else if (/haiku/i.test(id)) modelColor = C.green;

  // ── Line 1 items ──
  const line1 = [];
  const modelSeg = name ? `${modelColor}${C.bold}${name}${C.reset}` : '';
  if (FLAG && modelSeg) line1.push(`${FLAG} ${modelSeg}`);
  else if (modelSeg) line1.push(modelSeg);
  else if (FLAG) line1.push(FLAG);

  if (stdin.version) line1.push(`${C.cyan}v${stdin.version}${C.reset}`);

  const cw = stdin.context_window;
  if (cw) {
    const cu = cw.current_usage || {};
    const inputTokens = (cu.input_tokens ?? 0)
      + (cu.cache_creation_input_tokens ?? 0)
      + (cu.cache_read_input_tokens ?? 0);
    const total = cw.context_window_size ?? 0;
    const pct = typeof cw.used_percentage === 'number'
      ? Math.min(100, Math.max(0, Math.round(cw.used_percentage)))
      : (total > 0 ? Math.min(100, Math.round((inputTokens / total) * 100)) : 0);
    line1.push(`${C.white}ctx ${C.reset}${healthColor(pct)}${pct}%${C.reset}`);
  }

  const thinkingOn = settings.alwaysThinkingEnabled === true;
  line1.push(thinkingOn
    ? `${EMO.think} ${C.green}On${C.reset}`
    : `${EMO.think} ${C.gray}Off${C.reset}`);

  const effLvl = String(stdin?.effort?.level ?? settings?.effortLevel ?? '').toLowerCase();
  // Effort is an "increasing intensity" scale, so its colors avoid the health
  // palette's warning orange/red (those stay reserved for percentages).
  const effColorMap = {
    low: C.green, medium: C.cyan, high: C.blue,
    xhigh: C.magenta, ultracode: C.red, max: C.bRed,
  };
  if (effLvl) line1.push(`${C.white}effort ${C.reset}${effColorMap[effLvl] || C.white}${effLvl}${C.reset}`);

  const cwd = stdin.workspace?.current_dir ?? stdin.cwd ?? '';
  if (cwd) line1.push(`${EMO.cwd} ${C.white}${fmtCwd(cwd)}${C.reset}`);

  // ── Line 2 items: cpu · mem · disk first, then 5h · 7d quota ──
  const line2 = [];
  if (cpu) line2.push(cpuSegment(cpu));  // Linux only — null elsewhere
  const memSeg = usageSegment('mem', mem);
  if (memSeg) line2.push(memSeg);
  const diskSeg = usageSegment('disk', disk);
  if (diskSeg) line2.push(diskSeg);
  if (usage) {
    const q5 = quotaSeg('5h', usage.five_hour);
    const q7 = quotaSeg('7d', usage.seven_day);
    if (q5) line2.push(q5);
    if (q7) line2.push(q7);
  }

  return [line1.join(DOT), line2.join(DOT)].filter(Boolean);
}

// ── Main ────────────────────────────────────────────
async function main() {
  const stdin = await readStdin();
  if (!stdin) process.exit(0);

  const usage = await fetchUsage();

  const lines = buildLines(stdin, usage);
  if (!lines.length) process.exit(0);

  // Spaces → NBSP so the terminal doesn't collapse the intra-line spacing.
  console.log(lines.join('\n').replace(/ /g, ' '));
}

main();
