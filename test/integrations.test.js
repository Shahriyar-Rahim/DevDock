'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const S = path.join(__dirname, '..', 'scripts');
const sh = (home, script, args) => spawnSync(process.execPath, [path.join(S, script), '--yes', ...args], { env: { ...process.env, HOME: home, USERPROFILE: home, APPDATA: path.join(home, 'AppData') }, encoding: 'utf8' });

test('VS Code extension manifest is valid and commands are wired', () => {
  const dir = path.join(__dirname, '..', 'integrations', 'vscode-devdock'), pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const ids = pkg.contributes.commands.map(c => c.command), src = fs.readFileSync(path.join(dir, 'extension.js'), 'utf8');
  for (const id of ids) assert.ok(src.includes(`'${id}'`), id + ' not registered');
  assert.ok(pkg.contributes.menus['editor/context'].some(m => m.command === 'devdock.saveSelection'));
});
if (process.platform === 'linux') {
  test('install + uninstall: CLI wrapper, VS Code ext, file-manager entries', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-home-')); fs.mkdirSync(path.join(home, '.vscode', 'extensions'), { recursive: true });
    const i = sh(home, 'install-integrations.js', []); assert.equal(i.status, 0, i.stderr);
    const w = path.join(home, '.local/bin/devdock'); assert.ok(fs.existsSync(w)); assert.ok(fs.statSync(w).mode & 0o100);
    assert.match(fs.readFileSync(w, 'utf8'), /scripts\/cli\.js/);
    assert.ok(fs.existsSync(path.join(home, '.vscode/extensions/devdock.devdock-vscode-1.0.0/extension.js')));
    const naut = path.join(home, '.local/share/nautilus/scripts/Save Bookmark to DevDock'); assert.ok(fs.statSync(naut).mode & 0o100);
    assert.match(fs.readFileSync(path.join(home, '.local/share/nemo/actions/devdock-bookmark.nemo_action'), 'utf8'), /bookmarks add --notify %F/);
    assert.ok(fs.existsSync(path.join(home, '.local/share/kio/servicemenus/devdock-bookmark.desktop')));
    const u = sh(home, 'uninstall-integrations.js', []); assert.equal(u.status, 0, u.stderr);
    assert.ok(!fs.existsSync(w)); assert.ok(!fs.existsSync(naut)); assert.ok(!fs.existsSync(path.join(home, '.vscode/extensions/devdock.devdock-vscode-1.0.0')));
  });
  test('installer does nothing for targets that are not selected', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-home-')); sh(home, 'install-integrations.js', ['--cli']);
    assert.ok(fs.existsSync(path.join(home, '.local/bin/devdock'))); assert.ok(!fs.existsSync(path.join(home, '.local/share/nautilus')));
  });
  test('CLI install adds ~/.local/bin to PATH once (idempotent) and uninstall removes it cleanly', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-home-')), rc = path.join(home, '.bashrc'); fs.writeFileSync(rc, 'alias ll="ls -l"\n');
    const env = { ...process.env, HOME: home, PATH: '/usr/bin:/bin' };
    const run = (script) => spawnSync(process.execPath, [path.join(S, script), '--yes', '--cli'], { env, encoding: 'utf8' });
    assert.equal(run('install-integrations.js').status, 0); run('install-integrations.js');
    const c = fs.readFileSync(rc, 'utf8'); assert.equal(c.split('>>> devdock >>>').length - 1, 1); assert.match(c, /export PATH=".*\.local\/bin:\$PATH"/); assert.match(c, /alias ll/);
    const sh = spawnSync('sh', ['-c', `. "${rc}"; command -v devdock`], { env: { HOME: home, PATH: '/usr/bin:/bin' }, encoding: 'utf8' }); assert.equal(sh.stdout.trim(), path.join(home, '.local/bin/devdock'));
    run('uninstall-integrations.js'); const after = fs.readFileSync(rc, 'utf8'); assert.ok(!after.includes('devdock')); assert.match(after, /alias ll/);
  });
}
