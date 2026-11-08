'use strict';
const qs = new URLSearchParams(location.search), VIEW = qs.get('view') || 'main';
let S = null, SYS = null, page = qs.get('page') || 'dashboard', collapsed = false;
const ui = { sq: '', sl: '', sc: '', sort: 'modified', sfav: false, bq: '', bt: '', bsort: 'recent', termHist: [] };
const LANGS = ['C', 'C++', 'Python', 'Java', 'JavaScript', 'TypeScript', 'HTML', 'CSS', 'React', 'Node.js', 'Bash', 'SQL', 'JSON', 'Markdown', 'Dart', 'Other'];

/* ---------- helpers ---------- */
function h(tag, props, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'style') Object.assign(e.style, v);
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'class') e.className = v;
    else if (k !== 'list' && k in e) e[k] = v; else e.setAttribute(k, v);
  }
  for (const c of kids.flat(Infinity)) { if (c == null || c === false) continue; e.append(c.nodeType ? c : document.createTextNode(String(c))); }
  return e;
}
const btn = (t, f, c = '') => h('button', { class: c, onclick: f }, t);
const fb = n => { if (n == null) return '–'; const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; while (n >= 1024 && i < 4) { n /= 1024; i++; } return n.toFixed(i ? 1 : 0) + ' ' + u[i]; };
const ago = t => { if (!t) return 'never'; const s = (Date.now() - t) / 1000; return s < 60 ? 'just now' : s < 3600 ? Math.floor(s / 60) + 'm ago' : s < 86400 ? Math.floor(s / 3600) + 'h ago' : new Date(t).toLocaleDateString(); };
const upt = s => { const d = Math.floor(s / 86400), hh = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60); return (d ? d + 'd ' : '') + hh + 'h ' + m + 'm'; };
function toast(m) { const t = h('div', { class: 'toast' }, m); document.body.append(t); setTimeout(() => t.remove(), 2400); }
const field = (label, input) => h('div', { class: 'f' }, h('label', {}, label), input);
const sel = (opts, val, onch) => { const s = h('select', { onchange: () => onch(s.value) }, opts.map(o => { const [v, l] = Array.isArray(o) ? o : [o, o]; return h('option', { value: v, selected: v === val }, l); })); return s; };
const sortedBy = (a, f) => [...a].sort((x, y) => (y[f] || 0) - (x[f] || 0));
function modal(title, body, actions) {
  const ov = h('div', { class: 'overlay', onclick: e => { if (e.target === ov) ov.remove(); } },
    h('div', { class: 'modal', role: 'dialog' }, h('div', { class: 'mh' }, h('b', {}, title), h('button', { class: 'x', onclick: () => ov.remove(), title: 'Close' }, '✕')), body, h('div', { class: 'ma' }, actions.filter(Boolean))));
  document.body.append(ov); const i = ov.querySelector('input,textarea'); if (i) i.focus(); return ov;
}
function ask(msg) { return !S.settings.confirmDelete || confirm(msg); }

/* live system hosts */
const hosts = new Set();
function live(fn) { const el = h('div', { class: 'sec' }); const o = { el, fn, seen: false }; hosts.add(o); fn(el); return el; }
function refreshLive() { for (const o of [...hosts]) { if (o.el.isConnected) { o.seen = true; o.fn(o.el); } else if (o.seen) hosts.delete(o); } }
const bar = (p, warn) => h('div', { class: 'bar' }, h('div', { class: 'fill' + (p >= warn ? ' hi' : ''), style: { width: Math.min(100, p) + '%' } }));
function spark(arr, max) {
  const NS = 'http://www.w3.org/2000/svg', svg = document.createElementNS(NS, 'svg'), pl = document.createElementNS(NS, 'polyline');
  svg.setAttribute('class', 'spark'); svg.setAttribute('viewBox', '0 0 100 30'); svg.setAttribute('preserveAspectRatio', 'none');
  const m = max || Math.max(1, ...arr), n = Math.max(arr.length - 1, 1);
  pl.setAttribute('points', arr.map((v, i) => `${(i * 100 / n).toFixed(1)},${(30 - 28 * Math.min(v, m) / m).toFixed(1)}`).join(' ')); svg.append(pl); return svg;
}
function sysPanel(el, metrics, compact) {
  if (!SYS) { el.replaceChildren(h('div', { class: 'muted' }, 'Sampling…')); return; }
  const st = S.settings, X = SYS, n = [];
  if (metrics.includes('cpu')) n.push(h('div', { class: 'card' }, h('div', { class: 'row between' }, h('b', {}, 'CPU'), h('span', { class: 'big' }, X.cpu.avg + '%')), bar(X.cpu.avg, st.warnCpu), spark(X.hist.cpu, 100), h('div', { class: 'muted' }, `${X.cores} cores · ${X.speed || '?'} MHz`, compact ? '' : ' · ' + X.model),
    !compact && h('div', { class: 'muted' }, 'Per-core: ' + X.cpu.per.join('% ') + '%')));
  if (metrics.includes('ram')) n.push(h('div', { class: 'card' }, h('div', { class: 'row between' }, h('b', {}, 'RAM'), h('span', { class: 'big' }, X.ram.pct + '%')), bar(X.ram.pct, st.warnRam), spark(X.hist.ram, 100), h('div', { class: 'muted' }, `Used ${fb(X.ram.used)} / ${fb(X.ram.total)} · Available ${fb(X.ram.avail)}`)));
  if (metrics.includes('disk')) n.push(h('div', { class: 'card' }, h('b', {}, 'Storage'), X.disks.length ? X.disks.map(d => h('div', {}, h('div', { class: 'row between muted' }, h('span', {}, d.name), h('span', {}, `${fb(d.used)} / ${fb(d.total)} · free ${fb(d.free)}`)), bar(d.pct, st.warnDisk))) : h('div', { class: 'muted' }, 'No volumes detected')));
  if (metrics.includes('net')) n.push(h('div', { class: 'card' }, h('div', { class: 'row between' }, h('b', {}, 'Network'), h('span', { class: 'muted' }, X.net.iface)), h('div', { class: 'row between' }, h('span', {}, '↓ ' + fb(X.net.rxs) + '/s'), h('span', {}, '↑ ' + fb(X.net.txs) + '/s')), spark(X.hist.rx), h('div', { class: 'muted' }, `Total ↓ ${fb(X.net.rx)} · ↑ ${fb(X.net.tx)}`)));
  n.push(h('div', { class: 'muted' }, 'Uptime ' + upt(X.uptime) + (compact ? '' : ` · Peaks CPU ${X.peaks.cpu}% / RAM ${X.peaks.ram}%`)));
  el.replaceChildren(...n);
}

/* syntax highlight (lightweight, DOM-safe) */
const KW = 'const|let|var|function|return|if|else|for|while|class|import|from|export|def|public|private|static|void|int|char|float|double|new|try|catch|async|await|SELECT|FROM|WHERE|INSERT|UPDATE|DELETE|JOIN|echo|using|namespace|include|true|false|null|None|struct|enum|switch|case|break|this|self';
function highlight(code, lang) {
  const hash = ['Python', 'Bash'].includes(lang) ? '|#[^\\n]*' : '', sql = lang === 'SQL' ? '|--[^\\n]*' : '';
  const re = new RegExp(`(\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/${hash}${sql})|("(?:\\\\.|[^"\\\\\\n])*"|'(?:\\\\.|[^'\\\\\\n])*'|\`[^\`]*\`)|(\\b\\d+(?:\\.\\d+)?\\b)|(\\b(?:${KW})\\b)`, 'g');
  const frag = document.createDocumentFragment(); let last = 0, m;
  while ((m = re.exec(code))) {
    if (m.index > last) frag.append(code.slice(last, m.index));
    frag.append(h('span', { class: m[1] ? 'c' : m[2] ? 's' : m[3] ? 'n' : 'k' }, m[0])); last = m.index + m[0].length;
    if (m[0].length === 0) re.lastIndex++;
  }
  frag.append(code.slice(last)); return frag;
}
function codeView(code, lang) {
  const lines = code.split('\n').length;
  return h('div', { class: 'codebox' }, h('pre', { class: 'gut' }, Array.from({ length: lines }, (_, i) => i + 1).join('\n')), h('pre', { class: 'src' }, highlight(code, lang)));
}

/* ---------- snippet actions ---------- */
async function copySnip(s) { await api.copy(s.code); if (S.settings.copyNotify) toast('Copied to clipboard'); }
async function pasteSnip(s) { const r = await api.paste(s.code); if (!r.ok) toast(r.msg); }
function useSnip(s) { if (VIEW === 'main') return viewSnip(s); if (S.settings.alwaysPaste) return pasteSnip(s); viewSnip(s); }
function snipForm(init, title = 'Snippet') {
  const st = S.settings, v = { language: st.defaultLanguage, category: st.defaultCategory, ...init };
  const t = h('input', { value: v.title || '', placeholder: 'Title' }), d = h('input', { value: v.description || '' });
  const l = sel(LANGS, v.language, () => { }), c = h('input', { value: v.category || '', list: 'cats' }), g = h('input', { value: (v.tags || []).join(', ') });
  const code = h('textarea', { rows: 10, value: v.code || '' }), fav = h('input', { type: 'checkbox', checked: !!v.favorite });
  const cats = h('datalist', { id: 'cats' }, [...new Set(S.snippets.map(s => s.category))].map(x => h('option', { value: x })));
  const ov = modal(title, h('div', { class: 'sec' }, field('Title', t), h('div', { class: 'row' }, field('Language', l), field('Category', c), cats), field('Tags (comma separated)', g), field('Description', d), field('Code', code), h('label', { class: 'row' }, fav, 'Favorite')),
    [btn('Cancel', () => ov.remove()), btn('Save', async () => { if (!code.value.trim()) return toast('Code is empty'); await api.snipSave({ id: v.id, title: t.value, description: d.value, language: l.value, category: c.value, tags: g.value.split(','), code: code.value, favorite: fav.checked }); ov.remove(); toast('Snippet saved'); }, 'pri')]);
}
function viewSnip(s) {
  const main = VIEW === 'main';
  const ov = modal(s.title, h('div', { class: 'sec' }, h('div', { class: 'muted' }, `${s.language} · ${s.category} · modified ${ago(s.modified)}`), s.tags.length ? h('div', { class: 'row' }, s.tags.map(t => h('span', { class: 'tag' }, t))) : null, s.description ? h('div', {}, s.description) : null, codeView(s.code, s.language)),
    [btn(s.favorite ? '★ Unfavorite' : '☆ Favorite', async () => { await api.snipSave({ ...s, favorite: !s.favorite }); ov.remove(); }), btn('Copy', () => copySnip(s)),
    !main && btn('Paste into editor', () => pasteSnip(s)), !main && btn('Open in DevDock', () => { api.win('main', { page: 'snippets', id: s.id }); api.closeWin(); }),
    main && btn('Duplicate', async () => { await api.snipSave({ ...s, id: undefined, title: s.title + ' (copy)' }); ov.remove(); toast('Duplicated'); }),
    main && btn('Edit', () => { ov.remove(); snipForm(s, 'Edit snippet'); }), main && btn('Delete', async () => { if (ask('Delete this snippet?')) { await api.snipDel(s.id); ov.remove(); } }, 'danger')]);
}
const snipCard = s => h('div', { class: 'card click', onclick: () => viewSnip(s) },
  h('div', { class: 'row between' }, h('b', {}, s.title), s.favorite && h('span', { class: 'star' }, '★')),
  h('div', { class: 'row' }, h('span', { class: 'tag' }, s.language), h('span', { class: 'tag' }, s.category), h('span', { class: 'muted' }, ago(s.modified))),
  h('div', { class: 'prev' }, s.code.slice(0, 220)),
  h('div', { class: 'row' }, btn('Copy', e => { e.stopPropagation(); copySnip(s); }, 'sm'), btn('Open', e => { e.stopPropagation(); viewSnip(s); }, 'sm')));
const empty = t => h('div', { class: 'empty' }, t);
const clipToSnip = c => snipForm({ code: c.text, language: c.type === 'code' ? S.settings.defaultLanguage : 'Other' }, 'Save clipboard as snippet');

/* ---------- bookmarks ---------- */
async function openBm(b) { const r = await api.bmOpen(b.id); if (!r.ok) toast(r.msg); }
function bmForm(init = {}) {
  const v = { type: 'folder', color: '#D99A24', ...init };
  const n = h('input', { value: v.name || '' }), tg = h('input', { value: v.target || '', placeholder: v.type === 'url' ? 'https://…' : 'Absolute path' }), ty = sel(['folder', 'file', 'url'], v.type, () => { }),
    ca = h('input', { value: v.category || '' }), ic = h('input', { value: v.icon || '', maxLength: 2, placeholder: '📁' }), co = h('input', { type: 'color', value: v.color }), ds = h('input', { value: v.description || '' }),
    tgs = h('input', { value: (v.tags || []).join(', ') }), fav = h('input', { type: 'checkbox', checked: !!v.favorite });
  const ov = modal(v.id ? 'Edit' : 'Add folder / bookmark', h('div', { class: 'sec' }, field('Name', n), h('div', { class: 'row' }, field('Type', ty)), field('Target', h('div', { class: 'row' }, tg, btn('Browse', async () => { const p = await api.pick(ty.value === 'folder'); if (p) { tg.value = p; if (!n.value) n.value = p.split(/[\\/]/).filter(Boolean).pop() || p; } }))),
    h('div', { class: 'row' }, field('Category', ca), field('Icon', ic), field('Color', co)), field('Description', ds), field('Tags', tgs), h('label', { class: 'row' }, fav, 'Favorite')),
    [btn('Cancel', () => ov.remove()), btn('Save', async () => { const r = await api.bmSave({ id: v.id, name: n.value, target: tg.value, type: ty.value, category: ca.value, icon: ic.value, color: co.value, description: ds.value, tags: tgs.value.split(','), favorite: fav.checked }); if (!r.ok) return toast(r.msg); ov.remove(); toast('Saved'); }, 'pri')]);
}
const bmRow = (b, full) => h('div', { class: full ? 'card row between' : 'item', onclick: full ? null : () => openBm(b) },
  h('div', { class: 'row', style: { minWidth: 0 } }, h('span', { style: { color: b.color, fontSize: '1.3em' } }, b.icon || (b.type === 'url' ? '🔗' : b.type === 'file' ? '📄' : '📁')),
    h('div', { style: { minWidth: 0 } }, h('b', {}, b.name, b.favorite ? ' ★' : ''), h('div', { class: 'muted', style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, `${b.target}`), full && h('div', { class: 'muted' }, `${b.category} · ${b.type} · opened ${ago(b.lastOpened)}`))),
  full && h('div', { class: 'row' }, btn('Open', () => openBm(b), 'pri sm'), btn('Edit', () => bmForm(b), 'sm'), btn('Remove', async () => { if (ask('Remove this item?')) api.bmDel(b.id); }, 'sm danger')));

/* ---------- clipboard rows ---------- */
const imgCache = new Map();
function imgThumb(c) {
  const im = h('img', { alt: c.text, style: { maxWidth: '100%', maxHeight: '120px', borderRadius: '6px', display: 'block' } });
  if (imgCache.has(c.id)) im.src = imgCache.get(c.id); else api.clipImage(c.id).then(u => { if (u) { imgCache.set(c.id, u); im.src = u; } });
  return im;
}
const clipRow = (c, compact) => h('div', { class: 'card' },
  c.type === 'image' ? imgThumb(c) : h('div', { class: 'prev' }, c.text.slice(0, 300)),
  h('div', { class: 'row between' }, h('span', { class: 'muted' }, `${c.type === 'image' ? c.text : c.type} · ${ago(c.time)}${c.source ? ' · ' + c.source : ''}`), h('div', { class: 'row' },
    btn('Copy', async () => { if (c.type === 'image') await api.clipCopyImage(c.id); else await api.copy(c.text); toast('Copied'); }, 'sm'),
    c.type !== 'image' && btn('Save', () => clipToSnip(c), 'sm'), !compact && btn(c.pinned ? 'Unpin' : 'Pin', () => api.clipPin(c.id), 'sm'), btn('✕', () => api.clipDel(c.id), 'sm danger'))));

/* ---------- pages ---------- */
const nav = [['dashboard', '▦', 'Dashboard'], ['snippets', '</>', 'Snippets'], ['system', '◔', 'System Monitor'], ['files', '▤', 'Files & Bookmarks'], ['clipboard', '⎘', 'Recent Clipboard'], ['terminal', '>_', 'Terminal'], ['settings', '⚙', 'Settings']];
const go = p => { page = p; S.settings.lastPage !== p && api.settings({ lastPage: p }); render(); };
const head = (t, sub, ...acts) => h('div', { class: 'row between', style: { marginBottom: '14px' } }, h('div', {}, h('h1', {}, t), h('div', { class: 'muted' }, sub)), h('div', { class: 'row' }, acts));
const section = (t, link, ...body) => h('section', { class: 'sec' }, h('div', { class: 'row between' }, h('h2', {}, t), link), ...body);

function pDashboard() {
  const sn = sortedBy(S.snippets, 'modified').slice(0, 4), bm = [...S.bookmarks].sort((a, b) => (b.favorite - a.favorite) || b.lastOpened - a.lastOpened).slice(0, 5);
  return h('div', {}, head('Dashboard', 'Your developer workspace at a glance'),
    section('Quick actions', null, h('div', { class: 'row' }, btn('+ Snippet', () => snipForm({}), 'pri'), btn('+ Folder', () => bmForm({ type: 'folder' })), btn('+ Bookmark', () => bmForm({ type: 'url' })), btn('Clipboard history', () => go('clipboard')), btn('System monitor', () => go('system')), btn('Floating launcher', () => api.settings({ launcherEnabled: !S.settings.launcherEnabled })), btn('Settings', () => go('settings')))),
    section('Recently saved snippets', btn('View all →', () => go('snippets'), 'sm'), sn.length ? h('div', { class: 'grid g2' }, sn.map(snipCard)) : empty('No snippets yet — create one or save from clipboard.')),
    section('System resources', btn('Details →', () => go('system'), 'sm'), live(el => { const w = h('div', { class: 'grid g4' }); const t = h('div'); sysPanel(t, S.settings.dashMetrics, true); w.append(...t.children); el.replaceChildren(w); })),
    section('Folders & bookmarks', btn('Manage →', () => go('files'), 'sm'), bm.length ? h('div', { class: 'grid g2' }, bm.map(b => bmRow(b, false))) : empty('No folders or bookmarks saved.')),
    section('Recent clipboard', btn('Open →', () => go('clipboard'), 'sm'), S.clipboard.history.length ? h('div', { class: 'grid g2' }, S.clipboard.history.slice(0, 4).map(c => clipRow(c, true))) : empty(S.settings.clipEnabled ? 'Nothing captured yet. Copy some text anywhere.' : 'Clipboard monitoring is paused.')));
}
function pSnippets() {
  const list = h('div', { class: 'grid g2' });
  const draw = () => {
    const q = ui.sq.toLowerCase();
    let a = S.snippets.filter(s => (!q || (s.title + s.description + s.code + s.tags.join(' ')).toLowerCase().includes(q)) && (!ui.sl || s.language === ui.sl) && (!ui.sc || s.category === ui.sc) && (!ui.sfav || s.favorite));
    a = ui.sort === 'title' ? a.sort((x, y) => x.title.localeCompare(y.title)) : sortedBy(a, ui.sort);
    list.replaceChildren(...(a.length ? a.map(snipCard) : [empty('No snippets match.')]));
  };
  const search = h('input', { placeholder: 'Search title, code, tags…', value: ui.sq, oninput: e => { ui.sq = e.target.value; clearTimeout(search.t); search.t = setTimeout(draw, 150); } });
  draw();
  return h('div', {}, head('Code Snippet Vault', `${S.snippets.length} snippets`, btn('Import', async () => { const r = await api.dataImport(); if (r.msg) toast(r.msg); }, 'sm'), btn('Export all', async () => { const p = await api.dataExport(); if (p) toast('Exported'); }, 'sm'), btn('+ New snippet', () => snipForm({}), 'pri')),
    h('div', { class: 'row', style: { marginBottom: '12px' } }, h('div', { style: { flex: 1, minWidth: '200px' } }, search), sel([['', 'All languages'], ...LANGS], ui.sl, v => { ui.sl = v; draw(); }), sel([['', 'All categories'], ...[...new Set(S.snippets.map(s => s.category))]], ui.sc, v => { ui.sc = v; draw(); }),
      sel([['modified', 'Recently modified'], ['created', 'Recently created'], ['title', 'Title']], ui.sort, v => { ui.sort = v; draw(); }), h('label', { class: 'row' }, h('input', { type: 'checkbox', checked: ui.sfav, onchange: e => { ui.sfav = e.target.checked; draw(); } }), 'Favorites')), list);
}
function pSystem() {
  return h('div', {}, head('System Monitor', 'Live CPU, memory, storage and network', btn('Reset peaks', () => api.clear('peaks'), 'sm')), live(el => { const t = h('div'); sysPanel(t, ['cpu', 'ram', 'disk', 'net'], false); el.replaceChildren(h('div', { class: 'grid g2' }, ...t.children)); }));
}
function pFiles() {
  const list = h('div', { class: 'sec' });
  const draw = () => {
    const q = ui.bq.toLowerCase(); let a = S.bookmarks.filter(b => (!q || (b.name + b.target + b.category + b.tags.join(' ')).toLowerCase().includes(q)) && (!ui.bt || b.type === ui.bt));
    a = ui.bsort === 'name' ? a.sort((x, y) => x.name.localeCompare(y.name)) : sortedBy(a, ui.bsort === 'recent' ? 'lastOpened' : 'created');
    list.replaceChildren(...(a.length ? a.map(b => bmRow(b, true)) : [empty('Nothing saved yet.')]));
  };
  draw();
  return h('div', {}, head('Files & Bookmarks', 'Folders open in your file manager; files in their default app; URLs in your browser', btn('+ Folder', () => bmForm({ type: 'folder' })), btn('+ File', () => bmForm({ type: 'file' })), btn('+ URL', () => bmForm({ type: 'url' }), 'pri')),
    h('div', { class: 'row', style: { marginBottom: '12px' } }, h('div', { style: { flex: 1 } }, h('input', { placeholder: 'Search…', value: ui.bq, oninput: e => { ui.bq = e.target.value; draw(); } })), sel([['', 'All types'], 'folder', 'file', 'url'], ui.bt, v => { ui.bt = v; draw(); }), sel([['recent', 'Recently accessed'], ['created', 'Newest'], ['name', 'Name']], ui.bsort, v => { ui.bsort = v; draw(); })), list);
}
function pClipboard() {
  const s = S.settings;
  return h('div', {}, head('Recent Clipboard', s.clipEnabled ? 'Monitoring active (local only)' : 'Monitoring paused', btn(s.clipEnabled ? 'Pause' : 'Resume', () => api.settings({ clipEnabled: !s.clipEnabled })), btn('Clear unpinned', () => { if (ask('Clear clipboard history?')) api.clipClear(); }, 'danger')),
    S.clipboard.history.length ? h('div', { class: 'sec' }, S.clipboard.history.map(c => clipRow(c, false))) : empty('No clipboard entries.'));
}
function pTerminal() {
  const out = h('div', { class: 'out' }, 'DevDock CLI — type help'), hi = { i: ui.termHist.length };
  const inp = h('input', { placeholder: 'devdock status', onkeydown: async e => {
    if (e.key === 'ArrowUp') { hi.i = Math.max(0, hi.i - 1); inp.value = ui.termHist[hi.i] || ''; return; }
    if (e.key !== 'Enter') return; const l = inp.value.trim(); inp.value = ''; if (!l) return;
    ui.termHist.push(l); hi.i = ui.termHist.length;
    if (l === 'clear') return out.replaceChildren();
    out.append(h('div', { class: 'ok' }, '$ ' + l), h('div', {}, await api.term(l))); out.scrollTop = out.scrollHeight;
  } });
  return h('div', {}, head('Terminal', 'Allow-listed DevDock commands only — arbitrary shell commands are never executed'), h('div', { class: 'term' }, out, inp));
}

/* settings */
const sv = (k, v) => api.settings({ [k]: v });
const row = (l, c) => h('div', { class: 'setrow' }, h('span', {}, l), c);
const chk = (k, l) => row(l, h('input', { type: 'checkbox', checked: !!S.settings[k], onchange: e => sv(k, e.target.checked) }));
const num = (k, l, min, max, step = 1) => row(l, h('input', { type: 'number', min, max, step, value: S.settings[k], onchange: e => sv(k, +e.target.value) }));
const txt = (k, l, ph) => row(l, h('input', { value: S.settings[k], placeholder: ph || '', onchange: e => sv(k, e.target.value) }));
const rng = (k, l, min, max, step) => row(l, h('input', { type: 'range', min, max, step, value: S.settings[k], onchange: e => sv(k, +e.target.value) }));
const col = (k, l, isCustom) => { const cur = isCustom ? (S.settings.colors[k] || '') : S.settings[k]; return row(l, h('div', { class: 'row' }, h('input', { type: 'color', value: cur || '#D99A24', onchange: e => isCustom ? sv('colors', { ...S.settings.colors, [k]: e.target.value }) : sv(k, e.target.value) }), cur ? btn('auto', () => isCustom ? (() => { const c = { ...S.settings.colors }; delete c[k]; sv('colors', c); })() : sv(k, ''), 'sm') : h('span', { class: 'muted' }, 'theme'))); };
function accel(e) {
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return ''; const p = [];
  if (e.ctrlKey || e.metaKey) p.push('CommandOrControl'); if (e.altKey) p.push('Alt'); if (e.shiftKey) p.push('Shift');
  let k = e.key === ' ' ? 'Space' : e.key.length === 1 ? e.key.toUpperCase() : e.key.replace('Arrow', ''); if (!p.length) return ''; return [...p, k].join('+');
}
function pSettings() {
  const s = S.settings, sc = h('div'), names = { open: 'Open DevDock', clipboard: 'Clipboard history', picker: 'Snippet picker', launcher: 'Toggle launcher', system: 'System monitor', bookmarks: 'Files & bookmarks' };
  const drawSc = async () => { const f = await api.shortcutFails(); sc.replaceChildren(...Object.entries(names).map(([k, l]) => row(l + (f[k] ? ' ⚠ ' + f[k] : ''), h('input', { value: S.globalShortcuts[k] || '', readOnly: true, title: 'Click and press a combination', onkeydown: async e => { e.preventDefault(); const a = accel(e); if (!a) return; const r = await api.shortcuts({ [k]: a }); const msg = r[k]; toast(msg ? `${l}: ${msg}` : 'Shortcut saved'); } })))); };
  drawSc();
  const ddInfo = h('div', { class: 'muted' }, '…'); api.datadirGet().then(r => { ddInfo.textContent = r.dir + (r.custom ? ' (custom)' : ' (default)'); });
  const card = (t, ...b) => h('div', { class: 'card sec' }, h('h2', {}, t), ...b);
  return h('div', {}, head('Settings', 'Everything persists across restarts'),
    h('div', { class: 'grid g2' },
      card('Theme & appearance', row('Theme', sel([['light', 'Light + Amber (default)'], ['dark', 'Dark'], ['system', 'System'], ['matrix', 'Matrix']], s.theme, v => sv('theme', v))),
        col('accent', 'Primary accent'), col('accent2', 'Secondary accent'), col('bg', 'Background', true), col('sidebar', 'Sidebar', true), col('card', 'Cards', true), col('text', 'Text', true), col('border', 'Borders', true),
        row('Font family', sel([['system-ui', 'System UI'], ['Georgia,serif', 'Serif'], ['ui-monospace,Consolas,monospace', 'Monospace'], ['"Segoe UI",Roboto,sans-serif', 'Segoe/Roboto']], s.font, v => sv('font', v))),
        num('fontSize', 'Font size', 10, 22), row('Density', sel(['compact', 'normal', 'comfortable'], s.density, v => sv('density', v))), rng('radius', 'Border radius', 0, 24, 1), rng('shadow', 'Shadow intensity', 0, 3, 0.5), rng('anim', 'Animation speed (0 = off)', 0, 3, 0.5), rng('transparency', 'Card transparency', 0.5, 1, 0.05), rng('opacity', 'Widget opacity', 0.3, 1, 0.05),
        rng('matrixIntensity', 'Matrix intensity', 0, 1, 0.1), chk('reducedMotion', 'Reduced motion (stops Matrix rain)'), btn('Reset to default appearance', () => api.appearanceReset())),
      card('General', chk('launchAtStartup', 'Launch at startup'), chk('startMinimized', 'Start minimized'), chk('minimizeToTray', 'Minimize to tray'), chk('closeToTray', 'Close to tray'), chk('launcherEnabled', 'Floating launcher'), chk('restoreLastPage', 'Restore last page'), chk('confirmDelete', 'Confirm destructive actions'), num('hoverMs', 'Launcher hover delay (ms)', 500, 5000, 100)),
      card('Snippets', row('Default language', sel(LANGS, s.defaultLanguage, v => sv('defaultLanguage', v))), txt('defaultCategory', 'Default category'), chk('copyNotify', 'Copy notification'), chk('suggestClipSnippet', 'Suggest saving code clipboard entries'), chk('alwaysPaste', 'Always paste selected snippets directly into the active editor (popups)')),
      card('Clipboard', chk('clipEnabled', 'Monitoring enabled'), num('clipMax', 'History size', 10, 1000), num('clipRetentionDays', 'Retention (days)', 1, 365), txt('clipExclude', 'Exclude content containing', 'comma, separated'), chk('sensitiveFilter', 'Skip passwords / keys / tokens'), chk('clipImages', 'Capture images (stored locally, PNG)'), num('clipImageMaxMB', 'Max image size (MB)', 1, 20), txt('clipExcludeApps', 'Exclude copies from apps', 'e.g. keepassxc, 1password'), h('div', { class: 'muted' }, 'App exclusion needs active-window detection: X11 (xdotool/xprop), Windows, macOS. It cannot work on Wayland.')),
      card('System monitor', num('refreshMs', 'Refresh interval (ms)', 500, 60000, 100), row('Dashboard metrics', h('div', { class: 'row' }, ['cpu', 'ram', 'disk', 'net'].map(m => h('label', { class: 'row' }, h('input', { type: 'checkbox', checked: s.dashMetrics.includes(m), onchange: e => sv('dashMetrics', e.target.checked ? [...new Set([...s.dashMetrics, m])] : s.dashMetrics.filter(x => x !== m)) }), m)))), num('warnCpu', 'CPU warning %', 10, 100), num('warnRam', 'RAM warning %', 10, 100), num('warnDisk', 'Storage warning %', 10, 100), num('logRetention', 'Log retention (events)', 50, 5000)),
      card('Desktop widgets', ...Object.entries(WLABEL).map(([k, l]) => row(l.replace('⚡ ', 'Combined (all-in-one)'), h('input', { type: 'checkbox', checked: !!s.widgets[k], onchange: e => sv('widgets', { [k]: e.target.checked }) }))), h('div', { class: 'muted' }, 'Widgets are frameless, movable, resizable and use the Widget opacity setting.')),
      card('Global shortcuts', sc, btn('Reset to defaults', async () => { await api.shortcutsReset(); toast('Shortcuts reset'); })),
      card('Data directory', ddInfo, h('div', { class: 'row' }, btn('Change…', async () => { if (!confirm('DevDock will copy your data to the new folder and restart. Continue?')) return; const r = await api.datadirSet(); if (r && r.msg) toast(r.msg); }), btn('Use default', async () => { if (!confirm('Move back to the default location and restart?')) return; const r = await api.datadirReset(); if (r && r.msg) toast(r.msg); }, 'sm'))),
      card('Data', h('div', { class: 'muted' }, 'Stored locally in your user-data folder (data.json, system_log.json, backups/).'),
        h('div', { class: 'row' }, btn('Export', async () => { const p = await api.dataExport(); p && toast('Exported'); }), btn('Import', async () => { const r = await api.dataImport(); toast(r.ok ? 'Imported' : r.msg || 'Cancelled'); }), btn('Create backup', async () => { const p = await api.backup(); toast(p ? 'Backup created' : 'Nothing to back up'); }), btn('Restore backup', async () => { const r = await api.restore(); toast(r.ok ? 'Restored' : r.msg || 'Cancelled'); })),
        h('div', { class: 'row' }, ['snippets', 'clipboard', 'bookmarks', 'log'].map(k => btn('Clear ' + k, () => { if (ask('Clear all ' + k + '? A backup is made first.')) api.clear(k); }, 'sm danger'))),
        btn('Reset all settings', () => { if (confirm('Reset all settings and shortcuts to defaults?')) api.settingsReset(); }, 'danger'))));
}
const PAGES = { dashboard: pDashboard, snippets: pSnippets, system: pSystem, files: pFiles, clipboard: pClipboard, terminal: pTerminal, settings: pSettings };

/* ---------- views ---------- */
function renderMain() {
  const top = S.clipboard.history[0];
  document.getElementById('app').replaceChildren(
    h('aside', { class: 'side' + (collapsed ? ' collapsed' : '') }, h('div', { class: 'brand' }, h('div', { class: 'logo' }, '⚡'), h('span', { class: 'lbl' }, 'DevDock')),
      h('div', { class: 'peek', title: 'Click to copy latest clipboard entry', onclick: () => top && api.copy(top.text).then(() => toast('Copied')) }, top ? '⎘ ' + top.text.replace(/\s+/g, ' ').slice(0, 40) : '⎘ Clipboard empty'),
      nav.map(([id, ic, l]) => h('button', { class: 'nav' + (id === page ? ' on' : ''), onclick: () => go(id), title: l }, h('span', { class: 'ic' }, ic), h('span', { class: 'lbl' }, l))),
      h('div', { class: 'sp' }), h('button', { class: 'nav', onclick: () => { collapsed = !collapsed; render(); } }, h('span', { class: 'ic' }, collapsed ? '»' : '«'), h('span', { class: 'lbl' }, 'Collapse'))),
    h('main', { class: 'content' }, (PAGES[page] || pDashboard)()));
}
const popup = (title, ...body) => h('div', { class: 'popup' }, h('div', { class: 'ph' }, h('span', {}, title), h('button', { class: 'sm', onclick: () => api.closeWin() }, '✕')), h('div', { class: 'pb' }, ...body));
function renderPopup() {
  const A = document.getElementById('app'); let b;
  if (VIEW === 'snippets') {
    const list = h('div', { class: 'pb', style: { padding: 0 } }), q = h('input', { placeholder: 'Search snippets…', oninput: () => draw() });
    const draw = () => { const t = q.value.toLowerCase(); const a = [...S.snippets].filter(s => !t || (s.title + s.tags.join(' ') + s.language).toLowerCase().includes(t)).sort((x, y) => (y.favorite - x.favorite) || y.modified - x.modified); list.replaceChildren(...(a.length ? a.map(s => h('div', { class: 'item', onclick: () => useSnip(s) }, h('span', { class: 't' }, (s.favorite ? '★ ' : '') + s.title), h('span', { class: 'tag' }, s.language))) : [empty('No snippets')])); };
    draw(); b = popup('Snippets', q, list); setTimeout(() => q.focus(), 50);
  } else if (VIEW === 'system') b = popup('System Status', live(el => sysPanel(el, ['cpu', 'ram', 'disk', 'net'], true)));
  else if (VIEW === 'files') b = popup('Files & Bookmarks', ...(S.bookmarks.length ? sortedBy(S.bookmarks, 'lastOpened').map(x => bmRow(x, false)) : [empty('Nothing saved')]));
  else if (VIEW === 'clipboard') b = popup('Recent Clipboard', ...(S.clipboard.history.length ? S.clipboard.history.slice(0, 30).map(c => clipRow(c, true)) : [empty('Empty')]));
  else b = popup('Recently Saved', h('b', {}, 'Snippets'), ...sortedBy(S.snippets, 'modified').slice(0, 5).map(s => h('div', { class: 'item', onclick: () => useSnip(s) }, h('span', { class: 't' }, s.title), h('span', { class: 'muted' }, ago(s.modified)))), h('b', {}, 'Bookmarks'), ...sortedBy(S.bookmarks, 'created').slice(0, 5).map(x => bmRow(x, false)), h('b', {}, 'Clipboard'), ...S.clipboard.history.slice(0, 3).map(c => clipRow(c, true)));
  A.replaceChildren(b);
}
const WLABEL = { combined: '⚡ DevDock', cpu: 'CPU', ram: 'RAM', disk: 'Storage', net: 'Network', clipboard: 'Clipboard', snippets: 'Snippets', folders: 'Folders', bookmarks: 'Bookmarks' };
function renderWidget() {
  const kind = qs.get('kind') || 'combined', st = S.settings;
  const snips = n => sortedBy(S.snippets, 'modified').filter(s => kind !== 'combined' || s.favorite).slice(0, n).map(s => h('div', { class: 'item', onclick: () => copySnip(s) }, h('span', { class: 't' }, (s.favorite ? '★ ' : '') + s.title), h('span', { class: 'muted' }, 'copy')));
  let body;
  if (['cpu', 'ram', 'disk', 'net'].includes(kind)) body = [live(el => sysPanel(el, [kind], true))];
  else if (kind === 'clipboard') body = S.clipboard.history.length ? S.clipboard.history.slice(0, 8).map(c => clipRow(c, true)) : [empty('Clipboard empty')];
  else if (kind === 'snippets') body = snips(10);
  else if (kind === 'folders') body = S.bookmarks.filter(b => b.type === 'folder').slice(0, 10).map(b => bmRow(b, false));
  else if (kind === 'bookmarks') body = S.bookmarks.filter(b => b.type !== 'folder').slice(0, 10).map(b => bmRow(b, false));
  else body = [live(el => sysPanel(el, st.dashMetrics, true)), S.clipboard.history[0] && S.clipboard.history[0].type !== 'image' && h('div', { class: 'prev' }, S.clipboard.history[0].text.slice(0, 120)), ...snips(3), ...S.bookmarks.slice(0, 3).map(x => bmRow(x, false))];
  if (!body.length) body = [empty('Nothing here yet')];
  document.getElementById('app').replaceChildren(h('div', { class: 'popup widget' }, h('div', { class: 'ph' }, h('span', {}, WLABEL[kind] || kind),
    h('div', { class: 'row' }, kind === 'combined' && btn('Open', () => api.win('main', 'dashboard'), 'sm'), btn('✕', () => api.settings({ widgets: { [kind]: false } }), 'sm'))), h('div', { class: 'pb' }, ...body)));
}
let lbuilt = false;
function renderLauncher() {
  if (lbuilt) return; lbuilt = true; document.body.classList.add('launcher');
  const items = [['Dashboard', '▦', () => api.win('main', 'dashboard')], ['Code Snippets', '</>', () => api.win('snippets')], ['System Status', '◔', () => api.win('system')], ['Files & Bookmarks', '▤', () => api.win('files')], ['Recent Clipboard', '⎘', () => api.win('clipboard')], ['Recently Saved', '★', () => api.win('recent')], ['Settings', '⚙', () => api.win('main', 'settings')]];
  const ring = h('div', { class: 'ring' }), label = h('div', { class: 'lbl2' }), icon = h('div', { class: 'licon', title: 'DevDock — hover or click for menu, drag to move' }, '⚡');
  items.forEach(([n, ic, fn], i) => {
    const a = -Math.PI / 2 + i * 2 * Math.PI / items.length, b = h('button', { class: 'rb', title: n, onclick: () => { ring.classList.remove('open'); fn(); }, onmouseenter: () => { label.textContent = n; }, onmouseleave: () => { label.textContent = ''; } }, ic);
    b.style.setProperty('--tx', (88 * Math.cos(a)).toFixed(1) + 'px'); b.style.setProperty('--ty', (88 * Math.sin(a)).toFixed(1) + 'px'); ring.append(b);
  });
  const box = h('div', { class: 'lbox' }, ring, icon, label); let hover, away, drag = null, moved = false;
  icon.addEventListener('mouseenter', () => { clearTimeout(away); hover = setTimeout(() => ring.classList.add('open'), S.settings.hoverMs); });
  icon.addEventListener('mouseleave', () => clearTimeout(hover));
  box.addEventListener('mouseenter', () => clearTimeout(away));
  box.addEventListener('mouseleave', () => { away = setTimeout(() => ring.classList.remove('open'), 500); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') ring.classList.remove('open'); });
  icon.addEventListener('mousedown', e => { drag = { ox: e.screenX - window.screenX, oy: e.screenY - window.screenY, sx: e.screenX, sy: e.screenY }; moved = false; });
  window.addEventListener('mousemove', e => { if (!drag) return; if (Math.abs(e.screenX - drag.sx) + Math.abs(e.screenY - drag.sy) > 4) moved = true; if (moved) api.launcherMove(e.screenX - drag.ox, e.screenY - drag.oy); });
  window.addEventListener('mouseup', () => { if (!drag) return; if (moved) api.launcherSave(); else ring.classList.toggle('open'); drag = null; });
  document.getElementById('app').replaceChildren(box);
}

/* ---------- theme ---------- */
let mx = null, mxCols = [];
function matrixFx(on) {
  const c = document.getElementById('matrix'), st = S.settings;
  if (!on || st.reducedMotion || VIEW === 'launcher') { clearInterval(mx); mx = null; c.style.display = 'none'; return; }
  c.style.display = 'block'; c.style.opacity = (0.08 + 0.4 * st.matrixIntensity).toFixed(2);
  if (mx) return;
  const init = () => { c.width = innerWidth; c.height = innerHeight; mxCols = Array(Math.ceil(innerWidth / 16)).fill(0).map(() => Math.random() * -50); };
  init(); window.addEventListener('resize', init); const g = c.getContext('2d'), chars = 'ｱｲｳｴｵｶｷｸｹｺ0123456789ABCDEF<>{}/';
  mx = setInterval(() => { g.fillStyle = 'rgba(2,10,4,.12)'; g.fillRect(0, 0, c.width, c.height); g.fillStyle = '#00ff66'; g.font = '14px monospace'; mxCols.forEach((y, i) => { g.fillText(chars[Math.floor(Math.random() * chars.length)], i * 16, y * 16); mxCols[i] = y * 16 > c.height && Math.random() > .975 ? 0 : y + 1; }); }, 80 / Math.max(0.5, S.settings.anim || 1));
}
function applyTheme() {
  const st = S.settings, r = document.documentElement.style; let th = st.theme;
  if (th === 'system') th = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  document.documentElement.dataset.theme = th;
  const set = (k, v) => v ? r.setProperty(k, v) : r.removeProperty(k);
  set('--accent', st.accent); set('--accent2', st.accent2); if (st.accent) r.setProperty('--on-accent', '#1a1a1a'); else r.removeProperty('--on-accent');
  for (const k of ['bg', 'sidebar', 'card', 'text', 'border']) set('--' + k, st.colors[k]);
  r.setProperty('--font', st.font); r.setProperty('--fs', st.fontSize + 'px'); r.setProperty('--radius', st.radius + 'px');
  r.setProperty('--shadow', st.shadow ? `0 1px ${3 * st.shadow}px rgba(0,0,0,${(0.08 * st.shadow).toFixed(2)})` : 'none');
  r.setProperty('--t', (st.anim ? 0.15 / st.anim : 0) + 's'); r.setProperty('--alpha', st.transparency);
  r.setProperty('--pad', { compact: '9px', normal: '14px', comfortable: '20px' }[st.density]);
  matrixFx(th === 'matrix');
}
function render() {
  if (VIEW === 'main') renderMain(); else if (VIEW === 'widget') renderWidget(); else if (VIEW === 'launcher') renderLauncher(); else renderPopup();
}

(async () => {
  S = await api.state(); SYS = await api.sys(); applyTheme();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { applyTheme(); });
  api.onState(s => { S = s; applyTheme(); render(); });
  api.onSys(x => { SYS = x; refreshLive(); });
  api.onNav(n => { if (n && n.page) { page = n.page; render(); } if (n && n.id) { const s = S.snippets.find(x => x.id === n.id); if (s) viewSnip(s); } });
  render();
  const id = qs.get('id'); if (id) { const s = S.snippets.find(x => x.id === id); if (s) viewSnip(s); }
})();
