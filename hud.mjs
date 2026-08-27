#!/usr/bin/env node
/**
 * Claude Code HUD — a 3-line, column-aligned statusline for Claude Code.
 *
 *   Opus 5    ⋮ xhigh     ⋮ 💭 On     ⋮ 📁 ~/data/claude
 *   ctx  52%  ⋮ CH  99.2% ⋮ tok/s  164 ⋮ 5h ●●●○○ 58% ↻3h10m
 *   cpu  32%  ⋮ mem  37%  ⋮ disk  11%  ⋮ 7d ●○○○○ 17% ↻5d3h
 *
 * Layout: a fixed 4-column grid. Columns 1–3 have FIXED widths (never derived
 * from content) and are separated by a dashed rule, so a value changing from 9% to 100%
 * or a model swap can never shove the rest of the row sideways. Column 4 is
 * free — it holds the only genuinely variable-width content (cwd, quota rings)
 * and sits at the right edge where drift costs nothing.
 *
 * Within a metric cell the label is left-aligned and the value right-aligned
 * against the divider, so labels and digits each form their own sub-column.
 *
 * Data sources:
 *  - Everything on rows 1 and the quota column comes from the statusline stdin
 *    payload (model, effort, thinking, cwd, context_window, rate_limits).
 *    No network calls, no credentials, no token refresh — Claude Code hands us
 *    rate_limits directly.
 *  - CH (session cache-hit rate) and tok/s are aggregated from the session
 *    transcript JSONL, scanned incrementally: each render reads only the bytes
 *    appended since the last one and folds them into a cached running total.
 *  - cpu/mem read /proc (Linux only); disk uses statfs everywhere.
 *
 * Optional config: ~/.claude/hud/config.json
 *   { "diskPath": "/data", "cols": [9, 9, 10], "sep": "⋮" }
 */

import { readFileSync, writeFileSync, statfsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const VERSION = '2.0.0';

const HOME = homedir();
const HUD_DIR = join(HOME, '.claude', 'hud');
const SYS_CACHE_PATH = join(HUD_DIR, '.sys-cache.json');
const SESSION_CACHE_PATH = join(HUD_DIR, '.session-cache.json');

// ── User config (all optional) ──────────────────────
function loadConfig() {
  try {
    return JSON.parse(readFileSync(join(HUD_DIR, 'config.json'), 'utf8'));
  } catch { return {}; }
}
const CFG = loadConfig();
const DISK_PATH = typeof CFG.diskPath === 'string' ? CFG.diskPath : '/';
// Fixed widths for columns 1–3. Column 4 is free.
// Sized to the longest real content in each column and no wider: "Haiku 4.5",
// "ultracode", "tok/s 1234". Cell content is left-aligned against the divider;
// only the number inside a metric is right-padded, so digits still stack.
const COLS = Array.isArray(CFG.cols) && CFG.cols.length === 3
  ? CFG.cols.map(Number) : [9, 9, 10];

const EMO = { think: '💭', cwd: '📁' };

// ── Theme-aware palette ─────────────────────────────
const rgb = (r, g, b) => `\x1b[38;2;${r};${g};${b}m`;

function detectLightBg() {
  try {
    const s = JSON.parse(readFileSync(join(HOME, '.claude', 'settings.json'), 'utf8'));
    return typeof s.theme === 'string' && s.theme.startsWith('light');
  } catch { return false; }
}
const LIGHT_BG = detectLightBg();

const C = LIGHT_BG ? {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  blue: rgb(32, 94, 166), orange: rgb(188, 82, 21), green: rgb(30, 120, 40),
  cyan: rgb(36, 131, 123), red: rgb(175, 48, 41), yellow: rgb(173, 131, 1),
  magenta: rgb(94, 64, 157), white: rgb(64, 62, 55), gray: rgb(111, 110, 105),
  dimGray: rgb(183, 181, 172),
} : {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  blue: rgb(0, 153, 255), orange: rgb(255, 176, 85), green: rgb(0, 160, 0),
  cyan: rgb(46, 149, 153), red: rgb(255, 85, 85), yellow: rgb(230, 200, 0),
  magenta: rgb(200, 100, 255), white: rgb(220, 220, 220), gray: rgb(128, 128, 128),
  dimGray: rgb(80, 80, 80),
};

// Column divider. Default is a dashed rule: stacked across three rows a solid
// "│" welds into one unbroken line, which reads as a table border rather than
// as three separate rows. The dashes keep the columns aligned while letting the
// rows stay visually distinct. Override with "sep" in config.json.
const SEP = typeof CFG.sep === 'string' ? CFG.sep : '⋮';
const BAR = SEP ? `${C.dimGray}${SEP}${C.reset}` : '';

// ── Display width ───────────────────────────────────
// Column alignment is only as good as the width measurement. Strip ANSI, walk
// grapheme clusters, and count the double-width ones (CJK, emoji, flags) as 2.
const ANSI_RE = /\x1b\[[0-9;]*m/g;
const SEG = typeof Intl !== 'undefined' && Intl.Segmenter
  ? new Intl.Segmenter('en', { granularity: 'grapheme' }) : null;

function isWide(cp) {
  return (cp >= 0x1100 && cp <= 0x115F) || (cp >= 0x2E80 && cp <= 0xA4CF)
    || (cp >= 0xAC00 && cp <= 0xD7A3) || (cp >= 0xF900 && cp <= 0xFAFF)
    || (cp >= 0xFE30 && cp <= 0xFE6F) || (cp >= 0xFF00 && cp <= 0xFF60)
    || (cp >= 0xFFE0 && cp <= 0xFFE6) || (cp >= 0x1F300 && cp <= 0x1F9FF)
    || (cp >= 0x1FA70 && cp <= 0x1FAFF) || (cp >= 0x1F1E6 && cp <= 0x1F1FF);
}

function dispWidth(str) {
  const plain = str.replace(ANSI_RE, '');
  let w = 0;
  const clusters = SEG ? [...SEG.segment(plain)].map(s => s.segment) : [...plain];
  for (const g of clusters) {
    const cps = [...g].map(ch => ch.codePointAt(0));
    // A regional-indicator pair renders as one 2-cell flag.
    if (cps.some(isWide)) { w += 2; continue; }
    if (cps[0] === 0x200D || cps[0] === 0xFE0F) continue;
    w += 1;
  }
  return w;
}

// Pad to an exact column width; truncate with "…" if the content overflows.
function fit(str, width, align = 'left') {
  const w = dispWidth(str);
  if (w > width) {
    const plain = str.replace(ANSI_RE, '');
    let out = '', acc = 0;
    for (const ch of plain) {
      const cw = dispWidth(ch);
      if (acc + cw > width - 1) break;
      out += ch; acc += cw;
    }
    return out + '…' + ' '.repeat(Math.max(0, width - acc - 1));
  }
  const pad = ' '.repeat(width - w);
  return align === 'right' ? pad + str : str + pad;
}

// A metric cell: label, one space, then the value. The value carries its own
// fixed width (padStart) so 9% and 100% still line up, while the pair as a whole
// stays flush left instead of being stretched across the column.
function metric(label, value, width) {
  const body = `${C.white}${label}${C.reset} ${value}`;
  return fit(body, width);
}

// ── Helpers ─────────────────────────────────────────
function healthColor(pct) {
  if (pct >= 90) return C.red;
  if (pct >= 75) return C.orange;
  if (pct >= 50) return C.yellow;
  return C.green;
}

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

function quotaCircles(pct) {
  const clamped = Math.min(100, Math.max(0, pct));
  const full = Math.round(clamped / 20);
  const clr = healthColor(clamped);
  return `${clr}${'●'.repeat(full)}${C.dimGray}${'○'.repeat(5 - full)}${C.reset}`;
}

// "5h ●●●○○ 58% ↻3h10m" — lives in the free column, so only the ring block
// needs to be width-stable (it always renders 5 circles).
function quotaCell(label, bucket) {
  if (!bucket || typeof bucket.used_percentage !== 'number') return '';
  const pct = Math.round(bucket.used_percentage);
  const clr = healthColor(pct);
  const reset = fmtResetRelative(bucket.resets_at);
  const resetStr = reset ? ` ${C.gray}↻${reset}${C.reset}` : '';
  return `${C.white}${label} ${C.reset}${quotaCircles(pct)} ${clr}${String(pct).padStart(2)}%${C.reset}${resetStr}`;
}

// ── System stats ────────────────────────────────────
function readProcStat() {
  try {
    const line = readFileSync('/proc/stat', 'utf8').split('\n', 1)[0];
    const parts = line.trim().split(/\s+/).slice(1).map(Number);
    const [user = 0, nice = 0, system = 0, idle = 0, iowait = 0, irq = 0, softirq = 0, steal = 0] = parts;
    return { total: user + nice + system + idle + iowait + irq + softirq + steal, idle: idle + iowait, ts: Date.now() };
  } catch { return null; }
}

function getCpuPct() {
  const now = readProcStat();
  if (!now) return null;
  let pct = null;
  let cache = {};
  try { cache = JSON.parse(readFileSync(SYS_CACHE_PATH, 'utf8')); } catch { /* first run */ }
  if (cache?.cpu && (now.ts - cache.cpu.ts) < 30_000) {
    const totalDiff = now.total - cache.cpu.total;
    const idleDiff = now.idle - cache.cpu.idle;
    if (totalDiff > 0) pct = Math.max(0, Math.min(100, Math.round((1 - idleDiff / totalDiff) * 100)));
  }
  try { cache.cpu = now; writeFileSync(SYS_CACHE_PATH, JSON.stringify(cache)); } catch { /* ignore */ }
  return pct;
}

function getMemPct() {
  try {
    const raw = readFileSync('/proc/meminfo', 'utf8');
    const pick = (key) => {
      const m = raw.match(new RegExp(`^${key}:\\s+(\\d+)\\s*kB`, 'm'));
      return m ? parseInt(m[1], 10) : null;
    };
    const total = pick('MemTotal'), available = pick('MemAvailable');
    if (!total || available == null) return null;
    return Math.round(((total - available) / total) * 100);
  } catch { return null; }
}

function getDiskPct(path) {
  try {
    const s = statfsSync(path);
    const total = Number(s.blocks) * Number(s.bsize);
    if (!total) return null;
    return Math.round(((total - Number(s.bavail) * Number(s.bsize)) / total) * 100);
  } catch { return null; }
}

// ── Session stats: cache-hit rate + output speed ─────
// Both are session-wide facts that stdin cannot supply (its current_usage
// describes only the latest request), so they come from the transcript JSONL.
// The scan is incremental: state carries a byte offset plus running totals, and
// each render folds in only the newly appended lines.
function freshState(path) {
  return { path, offset: 0, prevTs: null, cur: null, seen: {}, seenN: 0,
           cr: 0, cc: 0, inp: 0, out: 0, recent: [], touched: Date.now() };
}

function loadSessionCache() {
  try { return JSON.parse(readFileSync(SESSION_CACHE_PATH, 'utf8')); } catch { return {}; }
}

function saveSessionCache(all) {
  try {
    // Drop sessions untouched for a day so the file cannot grow without bound.
    const cutoff = Date.now() - 86_400_000;
    for (const k of Object.keys(all)) if ((all[k]?.touched ?? 0) < cutoff) delete all[k];
    writeFileSync(SESSION_CACHE_PATH, JSON.stringify(all));
  } catch { /* ignore */ }
}

function finalizeReq(st) {
  const cur = st.cur;
  st.cur = null;
  if (!cur || cur.sidechain) return;
  const dur = (cur.last ?? 0) - (cur.start ?? 0);
  // Sub-second and absurd durations say more about when lines were flushed
  // than about generation speed, so they never enter the average.
  if (cur.out > 0 && dur >= 1000 && dur < 600_000) {
    st.recent.push({ out: cur.out, dur });
    if (st.recent.length > 5) st.recent.shift();
  }
}

function scanTranscript(st) {
  let buf;
  try { buf = readFileSync(st.path); } catch { return st; }
  if (buf.length < st.offset) st = freshState(st.path);   // truncated or rotated
  const end = buf.lastIndexOf(10) + 1;                    // only whole lines
  if (end <= st.offset) return st;

  for (const line of buf.subarray(st.offset, end).toString('utf8').split('\n')) {
    if (!line) continue;
    let d;
    try { d = JSON.parse(line); } catch { continue; }
    const ts = d.timestamp ? Date.parse(d.timestamp) : null;
    const u = d.type === 'assistant' ? d.message?.usage : null;

    if (u && d.requestId) {
      if (!st.seen[d.requestId]) {
        // A request's records are cumulative: usage repeats across them, so
        // only the first sighting contributes tokens.
        finalizeReq(st);
        st.seen[d.requestId] = 1;
        st.seenN++;
        st.cr += u.cache_read_input_tokens ?? 0;
        st.cc += u.cache_creation_input_tokens ?? 0;
        st.inp += u.input_tokens ?? 0;
        st.out += u.output_tokens ?? 0;
        st.cur = { id: d.requestId, start: st.prevTs, last: ts, out: u.output_tokens ?? 0,
                   sidechain: d.isSidechain === true };
      } else if (st.cur && st.cur.id === d.requestId) {
        st.cur.last = ts ?? st.cur.last;   // same response, later block
      }
    } else if (st.cur) {
      finalizeReq(st);
    }
    if (ts) st.prevTs = ts;
  }
  st.offset = end;

  // Keep the dedupe set bounded on very long sessions.
  const ids = Object.keys(st.seen);
  if (ids.length > 3000) for (const id of ids.slice(0, ids.length - 2000)) delete st.seen[id];
  st.touched = Date.now();
  return st;
}

function sessionStats(stdin) {
  const path = stdin.transcript_path
    || (stdin.session_id && stdin.cwd
        ? join(HOME, '.claude', 'projects', String(stdin.cwd).replace(/[/.]/g, '-'), `${stdin.session_id}.jsonl`)
        : null);
  if (!path) return null;

  const all = loadSessionCache();
  const key = stdin.session_id || path;
  let st = all[key];
  if (!st || st.path !== path) st = freshState(path);
  st = scanTranscript(st);
  all[key] = st;
  saveSessionCache(all);

  const totalIn = st.cr + st.cc + st.inp;
  const ch = totalIn > 0 ? (st.cr / totalIn) * 100 : null;

  // Speed over the last few completed requests, weighted by output size so one
  // short reply cannot swing the number.
  const window = st.recent.slice(-5);
  const outSum = window.reduce((a, r) => a + r.out, 0);
  const durSum = window.reduce((a, r) => a + r.dur, 0);
  const tps = durSum > 0 ? (outSum / (durSum / 1000)) : null;

  return { ch, tps, requests: st.seenN, out: st.out };
}

// ── cwd ─────────────────────────────────────────────
const CWD_MAX = 28;

function fmtCwd(cwd) {
  if (!cwd) return '';
  let p = cwd.startsWith(HOME) ? '~' + cwd.slice(HOME.length) : cwd;
  const wt = p.match(/^(.*?)\/\.claude\/worktrees\/([^/]+)$/);
  if (wt) p = `${wt[1].split('/').pop() || wt[1]}:wt/${wt[2]}`;
  if (p.length <= CWD_MAX) return p;
  const segs = p.split('/').filter(Boolean);
  if (segs.length >= 4) {
    const lead = p.startsWith('/') ? '/' : (p.startsWith('~') ? '~/' : '');
    const head = p.startsWith('~') ? '' : segs[0];
    const cand = `${lead}${head}${head ? '/' : ''}…/${segs.slice(-2).join('/')}`;
    if (cand.length <= CWD_MAX) return cand;
  }
  return '…' + p.slice(p.length - (CWD_MAX - 1));
}

// ── Grid ────────────────────────────────────────────
async function readStdin() {
  if (process.stdin.isTTY) return null;
  const chunks = [];
  try {
    process.stdin.setEncoding('utf8');
    for await (const chunk of process.stdin) chunks.push(chunk);
    const raw = chunks.join('');
    return raw.trim() ? JSON.parse(raw) : null;
  } catch { return null; }
}

function pctVal(pct) {
  return pct == null ? `${C.dim}  —${C.reset}`
    : `${healthColor(pct)}${String(pct).padStart(3)}%${C.reset}`;
}

function buildGrid(stdin) {
  const sess = sessionStats(stdin) || {};

  // Model name → "Opus 5": strip "Claude ", a "(1M context)" tail, a "[1m]" tail.
  const id = stdin.model?.id ?? '';
  const name = (stdin.model?.display_name || id.replace('claude-', '').replace(/-\d{8}$/, ''))
    .replace(/^claude\s+/i, '').replace(/\s*\([^)]*\)\s*$/, '').replace(/\s*\[[^\]]*\]\s*$/, '').trim();
  let modelColor = C.cyan;
  if (/opus/i.test(id)) modelColor = C.magenta;
  else if (/sonnet/i.test(id)) modelColor = C.cyan;
  else if (/haiku/i.test(id)) modelColor = C.green;
  const modelCell = `${modelColor}${C.bold}${name}${C.reset}`;

  const effLvl = String(stdin?.effort?.level ?? '').toLowerCase();
  const effColor = { low: C.green, medium: C.cyan, high: C.blue, xhigh: C.magenta,
                     ultracode: C.red, max: C.red }[effLvl] || C.white;
  const effCell = effLvl ? `${effColor}${effLvl}${C.reset}` : `${C.dim}—${C.reset}`;

  const thinkOn = stdin.thinking?.enabled !== false;
  const thinkCell = `${EMO.think} ${thinkOn ? C.green + 'On' : C.gray + 'Off'}${C.reset}`;

  const cwd = stdin.workspace?.current_dir ?? stdin.cwd ?? '';
  const cwdCell = cwd ? `${EMO.cwd} ${C.white}${fmtCwd(cwd)}${C.reset}` : '';

  const cw = stdin.context_window;
  const ctxPct = cw
    ? (typeof cw.used_percentage === 'number'
        ? Math.min(100, Math.max(0, Math.round(cw.used_percentage)))
        : (cw.context_window_size > 0
            ? Math.round((cw.total_input_tokens / cw.context_window_size) * 100) : null))
    : null;

  const chPct = sess.ch == null ? null : Math.round(sess.ch * 10) / 10;
  const chCell = chPct == null
    ? metric('CH', `${C.dim}    —${C.reset}`, COLS[1])
    // A high cache-hit rate is the healthy end here, so the health palette is
    // inverted: 99% must read green, not red.
    : metric('CH', `${healthColor(100 - chPct)}${chPct.toFixed(1).padStart(5)}%${C.reset}`, COLS[1]);

  const tpsCell = sess.tps == null
    ? metric('tok/s', `${C.dim}   —${C.reset}`, COLS[2])
    : metric('tok/s', `${C.cyan}${String(Math.round(sess.tps)).padStart(4)}${C.reset}`, COLS[2]);

  const rl = stdin.rate_limits || {};

  const joiner = BAR ? ` ${BAR} ` : '   ';
  const rows = [
    [fit(modelCell, COLS[0]), fit(effCell, COLS[1]), fit(thinkCell, COLS[2]), cwdCell],
    [metric('ctx', pctVal(ctxPct), COLS[0]), chCell, tpsCell, quotaCell('5h', rl.five_hour)],
    [metric('cpu', pctVal(getCpuPct()), COLS[0]),
     metric('mem', pctVal(getMemPct()), COLS[1]),
     metric('disk', pctVal(getDiskPct(DISK_PATH)), COLS[2]),
     quotaCell('7d', rl.seven_day)],
  ];

  return rows.map(cells => cells.filter(c => c !== '').join(joiner));
}

async function main() {
  const stdin = await readStdin();
  if (!stdin) process.exit(0);
  const lines = buildGrid(stdin);
  if (!lines.length) process.exit(0);
  // Spaces → NBSP so the terminal cannot collapse the grid's padding.
  console.log(lines.join('\n').replace(/ /g, ' '));
}

main();
