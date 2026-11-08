'use strict';
// Electron-free core logic shared by main.js, the CLI and the test-suite.
const fs = require('fs'), path = require('path'), os = require('os'), net = require('net'), crypto = require('crypto');

const SCHEMA = 2;
const DEF_SHORTCUTS = {
  open: 'CommandOrControl+Shift+D', clipboard: 'CommandOrControl+Shift+V', picker: 'CommandOrControl+Shift+S',
  launcher: 'CommandOrControl+Shift+Space', system: 'CommandOrControl+Shift+M', bookmarks: 'CommandOrControl+Shift+B'
};
const WIDGET_KINDS = ['combined', 'cpu', 'ram', 'disk', 'net', 'clipboard', 'snippets', 'folders', 'bookmarks'];
const DEF = () => ({
  schemaVersion: SCHEMA,
  settings: {
    theme: 'light', accent: '', accent2: '', colors: {}, font: 'system-ui', fontSize: 14, density: 'normal', radius: 10,
    shadow: 1, anim: 1, transparency: 1, opacity: 1, matrixIntensity: 0.5, reducedMotion: false,
    minimizeToTray: true, closeToTray: true, startMinimized: false, launchAtStartup: false,
    launcherEnabled: false, widgets: Object.fromEntries(WIDGET_KINDS.map(k => [k, false])), restoreLastPage: true, confirmDelete: true, lastPage: 'dashboard',
    alwaysPaste: false, defaultLanguage: 'JavaScript', defaultCategory: 'General', copyNotify: true, suggestClipSnippet: true,
    clipEnabled: true, clipMax: 100, clipRetentionDays: 7, clipExclude: '', clipExcludeApps: '', sensitiveFilter: true, clipImages: false, clipImageMaxMB: 5,
    refreshMs: 2000, dashMetrics: ['cpu', 'ram', 'disk', 'net'], warnCpu: 90, warnRam: 90, warnDisk: 90, logRetention: 500, hoverMs: 1500
  },
  systemStats: { peaks: { cpu: 0, ram: 0 } },
  snippets: [], clipboard: { history: [] }, bookmarks: [], globalShortcuts: { ...DEF_SHORTCUTS },
  launcherPos: null, widgetBounds: {}, recentItems: []
});
const CLAMP = { fontSize: [10, 22], radius: [0, 24], shadow: [0, 3], anim: [0, 3], transparency: [0.5, 1], opacity: [0.3, 1], matrixIntensity: [0, 1], clipMax: [10, 1000], clipRetentionDays: [1, 365], clipImageMaxMB: [1, 20], refreshMs: [500, 60000], warnCpu: [10, 100], warnRam: [10, 100], warnDisk: [10, 100], logRetention: [50, 5000], hoverMs: [500, 5000] };
const ENUMS = { theme: ['light', 'dark', 'system', 'matrix'], density: ['compact', 'normal', 'comfortable'] };
const HEX = /^#[0-9a-f]{6}$/i;

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const str = (v, n = 500) => (typeof v === 'string' ? v.slice(0, n) : '');
const tagsOf = v => (Array.isArray(v) ? v : []).map(t => str(t, 40).trim()).filter(Boolean).slice(0, 20);
const fb = n => { const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; n = n || 0; while (n >= 1024 && i < 4) { n /= 1024; i++; } return n.toFixed(i ? 1 : 0) + ' ' + u[i]; };

/* ---------- storage ---------- */
function merge(d, s) {
  for (const k in s) {
    if (s[k] && typeof s[k] === 'object' && !Array.isArray(s[k]) && d[k] && typeof d[k] === 'object' && !Array.isArray(d[k])) merge(d[k], s[k]);
    else d[k] = s[k];
  }
  return d;
}
function migrate(d) {
  const s = d.settings || (d.settings = {});
  if ((d.schemaVersion || 0) < 2) {
    if (s.widgetEnabled !== undefined) { s.widgets = { ...DEF().settings.widgets, ...(s.widgets || {}), combined: !!s.widgetEnabled }; }
    if (d.widgetBounds && typeof d.widgetBounds === 'object' && 'width' in d.widgetBounds) d.widgetBounds = { combined: d.widgetBounds };
  }
  delete s.widgetEnabled;
  if (!d.widgetBounds || typeof d.widgetBounds !== 'object') d.widgetBounds = {};
  d.schemaVersion = SCHEMA; return d;
}
function backupFile(file, dir, tag = 'manual') {
  if (!fs.existsSync(file)) return null;
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, `data-${Date.now()}-${tag}-${Math.random().toString(36).slice(2, 5)}.json`);
  fs.copyFileSync(file, f); return f;
}
function latestBackup(dir) {
  try { const l = fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort(); return l.length ? path.join(dir, l[l.length - 1]) : null; } catch { return null; }
}
function loadData(file, backupsDir) {
  try {
    if (!fs.existsSync(file)) return { data: DEF() };
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    if ((raw.schemaVersion || 0) < SCHEMA) backupFile(file, backupsDir, 'premigrate');
    return { data: migrate(merge(DEF(), raw)) };
  } catch {
    try { fs.renameSync(file, file + '.corrupt-' + Date.now()); } catch { /* ignore */ }
    const b = latestBackup(backupsDir);
    if (b) { try { return { data: migrate(merge(DEF(), JSON.parse(fs.readFileSync(b, 'utf8')))), recovered: true }; } catch { /* ignore */ } }
    return { data: DEF(), recovered: true };
  }
}
function saveData(file, data) { const t = file + '.tmp'; fs.writeFileSync(t, JSON.stringify(data, null, 2)); fs.renameSync(t, file); }

/* ---------- validation ---------- */
function sanitizeSnippet(s, ex, now = Date.now()) {
  s = s && typeof s === 'object' ? s : {};
  return { id: ex ? ex.id : uid(), title: str(s.title, 120).trim() || 'Untitled', description: str(s.description, 1000), language: str(s.language, 40) || 'Other', category: str(s.category, 60) || 'General', tags: tagsOf(s.tags), code: str(s.code, 200000), favorite: !!s.favorite, created: ex ? ex.created : now, modified: now };
}
function sanitizeBookmark(b, ex, all = []) {
  if (!b || typeof b !== 'object') return { ok: false, msg: 'Invalid' };
  const type = ['folder', 'file', 'url'].includes(b.type) ? b.type : 'folder', target = str(b.target, 2000).trim();
  if (type === 'url' ? !/^https?:\/\/\S+$/i.test(target) : !path.isAbsolute(target)) return { ok: false, msg: type === 'url' ? 'URL must start with http(s)://' : 'Path must be absolute' };
  if (all.some(x => x.target === target && (!ex || x.id !== ex.id))) return { ok: false, msg: 'Already saved' };
  return { ok: true, item: { id: ex ? ex.id : uid(), name: str(b.name, 100).trim() || target, target, type, description: str(b.description, 500), tags: tagsOf(b.tags), category: str(b.category, 60) || 'General', icon: str(b.icon, 4), color: HEX.test(b.color || '') ? b.color : '#D99A24', favorite: !!b.favorite, created: ex ? ex.created : Date.now(), lastOpened: ex ? ex.lastOpened : 0 } };
}
function applySettingsPatch(s, p) {
  const d = DEF().settings;
  for (const k in p) {
    if (!(k in d)) continue; let v = p[k];
    if (k === 'colors') { s.colors = {}; for (const c of ['bg', 'sidebar', 'card', 'text', 'border']) if (v && HEX.test(v[c] || '')) s.colors[c] = v[c]; continue; }
    if (k === 'dashMetrics') { if (Array.isArray(v)) s[k] = v.filter(x => ['cpu', 'ram', 'disk', 'net'].includes(x)); continue; }
    if (k === 'widgets') { if (v && typeof v === 'object') { const n = { ...s.widgets }; for (const w of WIDGET_KINDS) if (typeof v[w] === 'boolean') n[w] = v[w]; s.widgets = n; } continue; }
    if (k === 'accent' || k === 'accent2') { if (v === '' || HEX.test(v)) s[k] = v; continue; }
    if (typeof v !== typeof d[k] || (typeof v === 'number' && !Number.isFinite(v))) continue;
    if (typeof v === 'string') v = v.slice(0, 200);
    if (ENUMS[k] && !ENUMS[k].includes(v)) continue;
    if (CLAMP[k]) v = Math.min(CLAMP[k][1], Math.max(CLAMP[k][0], v));
    s[k] = v;
  }
  return s;
}

/* ---------- clipboard rules ---------- */
const SENSITIVE = [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, /\b(password|passwd|pwd|secret|api[_-]?key|token)\s*[:=]\s*\S+/i, /^(sk-|ghp_|gho_|xox[baprs]-|AKIA)[A-Za-z0-9_-]{12,}/, /^eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}$/];
const isSensitive = t => SENSITIVE.some(r => r.test(t));
function clipType(t) {
  if (/^https?:\/\/\S+$/.test(t.trim())) return 'url';
  if (/[{};]|=>|\b(function|def|class|import|return|#include)\b/.test(t) && (t.includes('\n') || /[;{}]/.test(t))) return 'code';
  return 'text';
}
const csv = v => String(v || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
function isExcluded(text, source, s) {
  const t = String(text || '').toLowerCase(), src = String(source || '').toLowerCase();
  return csv(s.clipExclude).some(x => t.includes(x)) || (!!src && csv(s.clipExcludeApps).some(a => src.includes(a)));
}
function pruneHistory(hist, s, now = Date.now()) {
  const cut = now - s.clipRetentionDays * 864e5; let n = 0; const kept = [], removed = [];
  for (const c of hist) { if (c.pinned || (c.time > cut && ++n <= s.clipMax)) kept.push(c); else removed.push(c); }
  return { kept, removed };
}

/* ---------- metrics math ---------- */
function cpuDelta(prev, cur) {
  let per = [];
  if (prev && prev.length === cur.length) per = cur.map((c, i) => { const dt = c.total - prev[i].total, di = c.idle - prev[i].idle; return dt > 0 ? Math.round(100 * (dt - di) / dt) : 0; });
  return { avg: per.length ? Math.round(per.reduce((a, b) => a + b, 0) / per.length) : 0, per };
}
function netSpeed(prev, cur, dtSec) {
  if (!prev || !cur || dtSec <= 0) return { rxs: 0, txs: 0 };
  return { rxs: Math.max(0, (cur.rx - prev.rx) / dtSec), txs: Math.max(0, (cur.tx - prev.tx) / dtSec) };
}

/* ---------- command parsing & data-only commands (shared by app, CLI offline mode, tests) ---------- */
const BOOL_FLAGS = new Set(['notify', 'json']);
function parseFlags(a) {
  const pos = [], flags = {};
  for (let i = 0; i < a.length; i++) {
    const t = a[i];
    if (t.startsWith('--') && t.length > 2) { const k = t.slice(2); if (!BOOL_FLAGS.has(k) && a[i + 1] !== undefined && !a[i + 1].startsWith('--')) flags[k] = a[++i]; else flags[k] = true; } else pos.push(t);
  }
  return { pos, flags };
}
function dataCmd(args, data) {
  const t = args.slice(); if (t[0] === 'devdock') t.shift();
  const [a, b] = t, { pos, flags } = parseFlags(t.slice(2));
  const meta = s => ({ id: s.id, title: s.title, language: s.language, category: s.category, tags: s.tags, favorite: s.favorite });
  const line = s => `[${s.id}] ${s.title} (${s.language})`;
  if (a === 'status') return `DevDock | snippets ${data.snippets.length} | clips ${data.clipboard.history.length} | bookmarks ${data.bookmarks.length} | clipboard ${data.settings.clipEnabled ? 'on' : 'paused'}`;
  if (a === 'snippets' || a === 'snippet') {
    if (b === 'list') return flags.json ? JSON.stringify(data.snippets.map(meta)) : data.snippets.map(line).join('\n') || 'No snippets';
    if (b === 'search') { const q = pos.join(' ').toLowerCase(), r = data.snippets.filter(s => (s.title + ' ' + s.description + ' ' + s.code + ' ' + s.tags.join(' ')).toLowerCase().includes(q)); return flags.json ? JSON.stringify(r.map(meta)) : r.map(line).join('\n') || 'No matches'; }
    if (b === 'get') { const s = data.snippets.find(x => x.id === pos[0]); return s ? s.code : 'Snippet not found'; }
  }
  if ((a === 'bookmarks' && (b === 'list' || b === undefined)) || a === 'folders') return data.bookmarks.filter(x => a === 'bookmarks' || x.type === 'folder').map(x => `[${x.id}] ${x.name} -> ${x.target}`).join('\n') || 'None';
  if (a === 'clipboard' && b === 'list') return data.clipboard.history.slice(0, 15).map((c, i) => `${i + 1}. ${c.type === 'image' ? '[image] ' + c.text : c.text.replace(/\s+/g, ' ').slice(0, 70)}`).join('\n') || 'Empty';
  return undefined;
}

/* ---------- boot dir, local IPC server/client ---------- */
const bootDir = () => process.env.DEVDOCK_HOME || path.join(os.homedir(), '.devdock');
function sockPath(boot) {
  if (process.platform === 'win32') return '\\\\.\\pipe\\devdock-' + crypto.createHash('sha1').update(boot).digest('hex').slice(0, 12);
  return path.join(boot, 'devdock.sock');
}
function safeEq(a, b) { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); }
function startCliServer(sock, token, handler) {
  if (process.platform !== 'win32') { try { fs.unlinkSync(sock); } catch { /* ignore */ } }
  const srv = net.createServer(c => {
    let buf = ''; c.setEncoding('utf8'); c.on('error', () => { });
    c.on('data', d => {
      buf += d; if (buf.length > 4e6) return c.destroy();
      const i = buf.indexOf('\n'); if (i < 0) return;
      let req; try { req = JSON.parse(buf.slice(0, i)); } catch { return c.end(JSON.stringify({ ok: false, out: 'bad request' }) + '\n'); }
      buf = '';
      if (!safeEq(req.token, token)) return c.end(JSON.stringify({ ok: false, out: 'unauthorized' }) + '\n');
      Promise.resolve(handler(Array.isArray(req.args) ? req.args.map(String) : [], typeof req.stdin === 'string' ? req.stdin : '')).then(r => c.end(JSON.stringify(r) + '\n'), e => c.end(JSON.stringify({ ok: false, out: String(e && e.message || e) }) + '\n'));
    });
  });
  srv.listen(sock, () => { if (process.platform !== 'win32') { try { fs.chmodSync(sock, 0o600); } catch { /* ignore */ } } });
  return srv;
}
function request(sock, token, args, stdin = '') {
  return new Promise((res, rej) => {
    const c = net.createConnection(sock); let buf = '';
    const t = setTimeout(() => { c.destroy(); rej(new Error('timeout')); }, 15000);
    c.setEncoding('utf8');
    c.on('connect', () => c.write(JSON.stringify({ token, args, stdin }) + '\n'));
    c.on('data', d => { buf += d; });
    c.on('end', () => { clearTimeout(t); try { res(JSON.parse(buf.trim())); } catch (e) { rej(e); } });
    c.on('error', e => { clearTimeout(t); rej(e); });
  });
}
function offline(args, dataFile) {
  let d; try { d = merge(DEF(), JSON.parse(fs.readFileSync(dataFile, 'utf8'))); } catch { return { ok: false, out: 'DevDock data not found. Start DevDock once first.' }; }
  const t = args.slice(); if (t[0] === 'devdock') t.shift();
  if (t[0] === 'backup') { const f = backupFile(dataFile, path.join(path.dirname(dataFile), 'backups'), 'cli'); return { ok: !!f, out: f ? 'Backup saved: ' + f : 'Nothing to back up' }; }
  if (t[0] === 'export') { if (!t[1]) return { ok: false, out: 'Usage: devdock export <file>' }; fs.copyFileSync(dataFile, t[1]); return { ok: true, out: 'Exported to ' + t[1] }; }
  const r = dataCmd(t, d);
  return r === undefined ? { ok: false, out: 'DevDock is not running — this command needs the running app. Start it with: devdock open' } : { ok: true, out: r + (t[0] === 'status' ? ' | (app not running)' : '') };
}

module.exports = { SCHEMA, DEF, DEF_SHORTCUTS, WIDGET_KINDS, uid, str, tagsOf, fb, merge, migrate, backupFile, latestBackup, loadData, saveData, sanitizeSnippet, sanitizeBookmark, applySettingsPatch, isSensitive, clipType, isExcluded, pruneHistory, cpuDelta, netSpeed, parseFlags, dataCmd, bootDir, sockPath, startCliServer, request, offline };
