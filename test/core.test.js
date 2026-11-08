'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const core = require('../core.js');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'devdock-t-'));

test('storage: save/load persists and round-trips', () => {
  const d = tmp(), f = path.join(d, 'data.json'), data = core.DEF();
  data.snippets.push(core.sanitizeSnippet({ title: 'A', code: 'x' }));
  core.saveData(f, data);
  const r = core.loadData(f, path.join(d, 'backups'));
  assert.equal(r.data.snippets[0].title, 'A'); assert.equal(r.data.schemaVersion, core.SCHEMA); assert.ok(!r.recovered);
});
test('storage: migrates v1 (widgetEnabled, single widgetBounds) and backs up first', () => {
  const d = tmp(), f = path.join(d, 'data.json'), old = core.DEF();
  old.schemaVersion = 1; old.settings.widgetEnabled = true; delete old.settings.widgets; old.widgetBounds = { x: 1, y: 2, width: 300, height: 400 };
  fs.writeFileSync(f, JSON.stringify(old));
  const r = core.loadData(f, path.join(d, 'backups'));
  assert.equal(r.data.settings.widgets.combined, true); assert.equal(r.data.settings.widgetEnabled, undefined);
  assert.equal(r.data.widgetBounds.combined.width, 300); assert.equal(r.data.schemaVersion, 2);
  assert.equal(fs.readdirSync(path.join(d, 'backups')).length, 1);
});
test('storage: corrupted file is quarantined and latest backup restored', () => {
  const d = tmp(), f = path.join(d, 'data.json'), b = path.join(d, 'backups'), data = core.DEF();
  data.snippets.push(core.sanitizeSnippet({ title: 'Keep', code: 'x' })); core.saveData(f, data); core.backupFile(f, b, 'manual');
  fs.writeFileSync(f, '{broken');
  const r = core.loadData(f, b);
  assert.ok(r.recovered); assert.equal(r.data.snippets[0].title, 'Keep');
  assert.ok(fs.readdirSync(d).some(n => n.includes('.corrupt-')));
});
test('storage: corrupted with no backup falls back to defaults', () => {
  const d = tmp(), f = path.join(d, 'data.json'); fs.writeFileSync(f, 'nope');
  const r = core.loadData(f, path.join(d, 'backups')); assert.ok(r.recovered); assert.deepEqual(r.data.snippets, []);
});
test('snippets: create / update keeps id+created / sanitizes', () => {
  const a = core.sanitizeSnippet({ title: '  ', code: 'c', tags: ['a', '', 'b'], language: 5 }, null, 100);
  assert.equal(a.title, 'Untitled'); assert.deepEqual(a.tags, ['a', 'b']); assert.equal(a.language, 'Other');
  const b = core.sanitizeSnippet({ title: 'T', code: 'd' }, a, 200);
  assert.equal(b.id, a.id); assert.equal(b.created, 100); assert.equal(b.modified, 200);
  assert.equal(core.sanitizeSnippet({ code: 'x'.repeat(300000) }).code.length, 200000);
});
test('bookmarks: validation, duplicates, edit allowed', () => {
  assert.equal(core.sanitizeBookmark({ type: 'folder', target: 'relative/dir' }).ok, false);
  assert.equal(core.sanitizeBookmark({ type: 'url', target: 'ftp://x' }).ok, false);
  assert.equal(core.sanitizeBookmark({ type: 'url', target: 'javascript:alert(1)' }).ok, false);
  const a = core.sanitizeBookmark({ type: 'url', target: 'https://example.com', name: 'Ex' }, null, []); assert.ok(a.ok);
  assert.equal(core.sanitizeBookmark({ type: 'url', target: 'https://example.com' }, null, [a.item]).ok, false);
  assert.ok(core.sanitizeBookmark({ type: 'url', target: 'https://example.com', name: 'New' }, a.item, [a.item]).ok);
  assert.ok(core.sanitizeBookmark({ type: 'folder', target: path.resolve('/tmp') }, null, []).ok);
});
test('settings patch: clamps, rejects bad types/enums/colors, merges widgets', () => {
  const s = core.DEF().settings;
  core.applySettingsPatch(s, { fontSize: 999, theme: 'neon', accent: 'red', clipMax: 'x', refreshMs: 1, nope: 1, widgets: { cpu: true, bogus: true }, colors: { bg: '#112233', text: 'zzz' } });
  assert.equal(s.fontSize, 22); assert.equal(s.theme, 'light'); assert.equal(s.accent, ''); assert.equal(s.clipMax, 100); assert.equal(s.refreshMs, 500);
  assert.equal(s.widgets.cpu, true); assert.equal(s.widgets.bogus, undefined); assert.equal(s.widgets.combined, false);
  assert.deepEqual(s.colors, { bg: '#112233' });
  core.applySettingsPatch(s, { theme: 'system', accent: '#FFAA00' }); assert.equal(s.theme, 'system'); assert.equal(s.accent, '#FFAA00');
});
test('clipboard: type detection and sensitive filtering', () => {
  assert.equal(core.clipType('https://a.com/x'), 'url'); assert.equal(core.clipType('const a = 1;\nreturn a;'), 'code'); assert.equal(core.clipType('hello world'), 'text');
  assert.ok(core.isSensitive('password = hunter2')); assert.ok(core.isSensitive('-----BEGIN RSA PRIVATE KEY-----\nabc')); assert.ok(core.isSensitive('ghp_abcdefghijklmnop1234')); assert.ok(!core.isSensitive('just some notes'));
});
test('clipboard: exclusion by content and by source app', () => {
  const s = { clipExclude: 'bank, secret', clipExcludeApps: 'KeePassXC, 1password' };
  assert.ok(core.isExcluded('my BANK pin', '', s)); assert.ok(core.isExcluded('hello', 'keepassxc', s)); assert.ok(core.isExcluded('hello', '1Password 7', s));
  assert.ok(!core.isExcluded('hello', 'code', s)); assert.ok(!core.isExcluded('hello', '', s));
});
test('clipboard: pruning respects size limit, retention and pinned', () => {
  const now = Date.now(), mk = (id, ageDays, pinned) => ({ id, time: now - ageDays * 864e5, pinned: !!pinned });
  const { kept, removed } = core.pruneHistory([mk('a', 0), mk('b', 1), mk('c', 2), mk('old', 30), mk('oldpin', 30, true)], { clipMax: 2, clipRetentionDays: 7 }, now);
  assert.deepEqual(kept.map(x => x.id), ['a', 'b', 'oldpin']); assert.deepEqual(removed.map(x => x.id), ['c', 'old']);
});
test('system: CPU delta uses time deltas', () => {
  const prev = [{ idle: 100, total: 200 }, { idle: 0, total: 100 }], cur = [{ idle: 150, total: 300 }, { idle: 0, total: 200 }];
  const r = core.cpuDelta(prev, cur); assert.deepEqual(r.per, [50, 100]); assert.equal(r.avg, 75);
  assert.equal(core.cpuDelta(null, cur).avg, 0);
});
test('system: network speed from counter deltas, counter reset clamps to 0', () => {
  assert.deepEqual(core.netSpeed({ rx: 1000, tx: 500 }, { rx: 3000, tx: 1500 }, 2), { rxs: 1000, txs: 500 });
  assert.deepEqual(core.netSpeed({ rx: 5000, tx: 5000 }, { rx: 10, tx: 10 }, 1), { rxs: 0, txs: 0 });
  assert.deepEqual(core.netSpeed(null, { rx: 1, tx: 1 }, 1), { rxs: 0, txs: 0 });
});
test('commands: parseFlags and data-only commands', () => {
  const p = core.parseFlags(['a', '--title', 'T', '--json', 'b', '--notify', '/x']);
  assert.deepEqual(p.pos, ['a', 'b', '/x']); assert.equal(p.flags.title, 'T'); assert.equal(p.flags.json, true); assert.equal(p.flags.notify, true);
  const d = core.DEF(); d.snippets.push({ ...core.sanitizeSnippet({ title: 'Express', code: 'app.listen()', tags: ['node'] }), id: 's1' });
  assert.match(core.dataCmd(['snippets', 'list'], d), /\[s1\] Express/);
  assert.equal(core.dataCmd(['snippets', 'get', 's1'], d), 'app.listen()'); assert.equal(core.dataCmd(['snippets', 'get', 'zz'], d), 'Snippet not found');
  assert.equal(JSON.parse(core.dataCmd(['snippets', 'search', 'node', '--json'], d))[0].id, 's1');
  assert.equal(core.dataCmd(['snippets', 'search', 'nomatch'], d), 'No matches'); assert.equal(core.dataCmd(['launcher'], d), undefined);
  assert.match(core.dataCmd(['devdock', 'status'], d), /snippets 1/);
});
