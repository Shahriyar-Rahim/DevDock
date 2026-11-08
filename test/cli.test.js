'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync, spawn } = require('child_process');
const core = require('../core.js');
const CLI = path.join(__dirname, '..', 'scripts', 'cli.js');
const run = (boot, args, input) => spawnSync(process.execPath, [CLI, ...args], { env: { ...process.env, DEVDOCK_HOME: boot }, input, encoding: 'utf8' });
const mkBoot = () => fs.mkdtempSync(path.join(os.tmpdir(), 'dd-boot-'));
function seed(boot) {
  const dd = path.join(boot, 'data'); fs.mkdirSync(dd, { recursive: true }); const d = core.DEF();
  d.snippets.push({ ...core.sanitizeSnippet({ title: 'Hello', code: 'echo hi', tags: ['sh'] }), id: 'abc' }); core.saveData(path.join(dd, 'data.json'), d); return dd;
}

test('server rejects wrong token, accepts right token, passes args+stdin', async () => {
  const boot = mkBoot(), sock = core.sockPath(boot);
  const srv = core.startCliServer(sock, 'tok', async (args, stdin) => ({ ok: true, out: JSON.stringify({ args, stdin }) }));
  await new Promise(r => srv.on('listening', r));
  try {
    const bad = await core.request(sock, 'WRONG', ['x']); assert.equal(bad.ok, false); assert.equal(bad.out, 'unauthorized');
    const good = await core.request(sock, 'tok', ['snippets', 'add'], 'code'); assert.equal(good.ok, true); assert.deepEqual(JSON.parse(good.out), { args: ['snippets', 'add'], stdin: 'code' });
  } finally { srv.close(); }
});
if (process.platform !== 'win32') test('socket file is private (0600)', async () => {
  const boot = mkBoot(), sock = core.sockPath(boot), srv = core.startCliServer(sock, 't', async () => ({ ok: true, out: '' }));
  await new Promise(r => srv.on('listening', r)); await new Promise(r => setTimeout(r, 50));
  try { assert.equal(fs.statSync(sock).mode & 0o777, 0o600); } finally { srv.close(); }
});
test('CLI talks to a running app over the socket', async () => {
  const boot = mkBoot(), sock = core.sockPath(boot);
  const srv = core.startCliServer(sock, 'secret', async args => ({ ok: true, out: 'app says: ' + args.join(' ') }));
  await new Promise(r => srv.on('listening', r));
  fs.writeFileSync(path.join(boot, 'runtime.json'), JSON.stringify({ socket: sock, token: 'secret', dataDir: path.join(boot, 'data') }));
  const r = await new Promise(res => { const c = spawn(process.execPath, [CLI, 'system', 'cpu'], { env: { ...process.env, DEVDOCK_HOME: boot } }); let o = ''; c.stdout.on('data', d => o += d); c.on('close', code => res({ code, o })); });
  srv.close(); assert.equal(r.code, 0); assert.match(r.o, /app says: system cpu/);
});
test('CLI offline: list/search/get/status/backup/export work without the app', () => {
  const boot = mkBoot(), dd = seed(boot);
  fs.writeFileSync(path.join(boot, 'runtime.json'), JSON.stringify({ socket: path.join(boot, 'dead.sock'), token: 'x', dataDir: dd }));
  assert.match(run(boot, ['snippets', 'list']).stdout, /\[abc\] Hello/);
  assert.match(run(boot, ['snippets', 'search', 'echo']).stdout, /Hello/);
  assert.equal(run(boot, ['snippets', 'get', 'abc']).stdout.trim(), 'echo hi');
  assert.match(run(boot, ['status']).stdout, /app not running/);
  assert.match(run(boot, ['backup']).stdout, /Backup saved/);
  const out = path.join(boot, 'out.json'); assert.equal(run(boot, ['export', out]).status, 0); assert.ok(fs.existsSync(out));
  const live = run(boot, ['system', 'cpu']); assert.equal(live.status, 1); assert.match(live.stdout, /not running/);
});
test('CLI without any DevDock data gives a clear error', () => {
  const r = run(mkBoot(), ['snippets', 'list']); assert.equal(r.status, 1); assert.match(r.stdout, /Start DevDock once/);
});
