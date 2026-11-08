#!/usr/bin/env node
'use strict';
// Installs / removes DevDock integrations. Nothing is installed without confirmation (or --yes).
//   node scripts/install-integrations.js [--cli] [--vscode] [--filemanager] [--yes]
//   node scripts/uninstall-integrations.js [--cli] [--vscode] [--filemanager] [--yes]
const fs = require('fs'), path = require('path'), os = require('os'), readline = require('readline');
const { execFileSync } = require('child_process');
const P = process.platform, HOME = os.homedir();
const CLI = path.join(__dirname, 'cli.js').replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
const EXT_SRC = path.join(__dirname, '..', 'integrations', 'vscode-devdock').replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
const argv = process.argv.slice(2), yes = argv.includes('--yes'), only = argv.filter(a => ['--cli', '--vscode', '--filemanager'].includes(a)).map(a => a.slice(2));
const want = t => !only.length || only.includes(t);
const log = m => console.log(m);
const BIN = P === 'win32' ? path.join(process.env.APPDATA || path.join(HOME, 'AppData', 'Roaming'), 'devdock-bin') : path.join(HOME, '.local', 'bin');
const WRAPPER = path.join(BIN, P === 'win32' ? 'devdock.cmd' : 'devdock');
const rm = p => { try { fs.rmSync(p, { recursive: true, force: true }); return true; } catch { return false; } };
const write = (p, c, mode) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, c, mode ? { mode } : undefined); };
const ask = q => yes ? Promise.resolve(true) : new Promise(r => { const rl = readline.createInterface({ input: process.stdin, output: process.stdout }); rl.question(q + ' [y/N] ', a => { rl.close(); r(/^y/i.test(a)); }); });
const MARK_B = '# >>> devdock >>>', MARK_E = '# <<< devdock <<<';
const onPath = () => (process.env.PATH || '').split(path.delimiter).includes(BIN);
const rcCandidates = () => ['.zshrc', '.bashrc', '.profile', '.zprofile'].map(f => path.join(HOME, f));
const psUser = script => execFileSync('powershell', ['-NoProfile', '-Command', script], { windowsHide: true });
function addPath() {
  if (P === 'win32') {
    psUser(`$b='${BIN}';$u=[Environment]::GetEnvironmentVariable('Path','User');if(-not $u){$u=''};$p=@($u.Split(';')|Where-Object{$_ -and $_ -ne $b});[Environment]::SetEnvironmentVariable('Path',(($p+$b) -join ';'),'User')`);
    return log('Added to your user PATH. Open a NEW terminal for `devdock` to work everywhere.');
  }
  if (onPath()) return log(`${BIN} is already on PATH.`);
  let files = rcCandidates().filter(f => fs.existsSync(f)); if (!files.length) files = [path.join(HOME, '.profile')];
  for (const f of files) {
    const cur = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : ''; if (cur.includes(MARK_B)) continue;
    fs.appendFileSync(f, `\n${MARK_B}\ncase ":$PATH:" in *":${BIN}:"*) ;; *) export PATH="${BIN}:$PATH" ;; esac\n${MARK_E}\n`); log('Updated ' + f);
  }
  const fish = path.join(HOME, '.config/fish/config.fish');
  if (fs.existsSync(fish) && !fs.readFileSync(fish, 'utf8').includes(MARK_B)) { fs.appendFileSync(fish, `\n${MARK_B}\nfish_add_path ${BIN}\n${MARK_E}\n`); log('Updated ' + fish); }
  log('Open a NEW terminal (or run: source ~/.profile) for `devdock` to work everywhere.');
}
function removePath() {
  if (P === 'win32') { try { psUser(`$b='${BIN}';$u=[Environment]::GetEnvironmentVariable('Path','User');if($u){[Environment]::SetEnvironmentVariable('Path',((@($u.Split(';')|Where-Object{$_ -and $_ -ne $b})) -join ';'),'User')}`); log('Removed from user PATH'); } catch { log('PATH entry not changed'); } return; }
  const re = new RegExp(`\\n?${MARK_B}[\\s\\S]*?${MARK_E}\\n?`, 'g');
  for (const f of [...rcCandidates(), path.join(HOME, '.config/fish/config.fish')]) { if (!fs.existsSync(f)) continue; const c = fs.readFileSync(f, 'utf8'); if (c.includes(MARK_B)) { fs.writeFileSync(f, c.replace(re, '\n')); log('Cleaned ' + f); } }
}
const xml = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const T = {
  cli: {
    install() {
      if (P === 'win32') write(WRAPPER, `@echo off\r\nnode "${CLI}" %*\r\n`);
      else write(WRAPPER, `#!/bin/sh\nexec node "${CLI}" "$@"\n`, 0o755);
      log(`CLI installed: ${WRAPPER}`);
      return ask(`Add ${BIN} to your PATH so \`devdock\` works from every terminal?`).then(ok => ok ? addPath() : log(`Skipped. Add ${BIN} to PATH yourself, or run ${WRAPPER} by full path.`));
    },
    uninstall() { log(rm(WRAPPER) ? 'CLI wrapper removed' : 'CLI wrapper not found'); removePath(); }
  },
  vscode: {
    dirs() { return ['.vscode', '.vscode-oss', '.vscode-insiders', '.cursor'].map(d => path.join(HOME, d, 'extensions')).filter(d => fs.existsSync(d)); },
    install() {
      const ds = this.dirs(); if (!ds.length) return log('VS Code extensions folder not found (~/.vscode/extensions). Install VS Code and run it once, then retry.');
      for (const d of ds) { const t = path.join(d, 'devdock.devdock-vscode-1.0.0'); rm(t); fs.cpSync(EXT_SRC, t, { recursive: true }); log('VS Code extension installed: ' + t); }
      log('Reload VS Code (Developer: Reload Window). Right-click selected code → "Save to DevDock".');
    },
    uninstall() { for (const d of this.dirs()) { const t = path.join(d, 'devdock.devdock-vscode-1.0.0'); log(rm(t) ? 'Removed ' + t : 'Not found: ' + t); } }
  },
  filemanager: {
    files() {
      return {
        nautilus: path.join(HOME, '.local/share/nautilus/scripts/Save Bookmark to DevDock'),
        nemo: path.join(HOME, '.local/share/nemo/actions/devdock-bookmark.nemo_action'),
        dolphin: path.join(HOME, '.local/share/kio/servicemenus/devdock-bookmark.desktop'),
        mac: path.join(HOME, 'Library/Services/Save Bookmark to DevDock.workflow')
      };
    },
    install() {
      const f = this.files(), cmd = P === 'win32' ? WRAPPER : WRAPPER;
      if (!fs.existsSync(WRAPPER)) log(`Note: ${WRAPPER} does not exist yet — run with --cli too, otherwise the menu entries will do nothing.`);
      if (P === 'linux') {
        write(f.nautilus, `#!/bin/sh\nIFS='\n'\nfor p in $NAUTILUS_SCRIPT_SELECTED_FILE_PATHS; do [ -n "$p" ] && "${cmd}" bookmarks add --notify "$p"; done\n`, 0o755);
        write(f.nemo, `[Nemo Action]\nName=Save Bookmark to DevDock\nComment=Add the selection to DevDock bookmarks\nExec="${cmd}" bookmarks add --notify %F\nSelection=any\nExtensions=any;\nIcon-Name=bookmark-new\n`);
        write(f.dolphin, `[Desktop Entry]\nType=Service\nServiceTypes=KonqPopupMenu/Plugin\nMimeType=all/all;\nActions=devdockBookmark;\nX-KDE-Priority=TopLevel\n\n[Desktop Action devdockBookmark]\nName=Save Bookmark to DevDock\nIcon=bookmark-new\nExec="${cmd}" bookmarks add --notify %F\n`, 0o755);
        log('Installed for Nautilus (Scripts menu), Nemo (actions) and Dolphin (service menu). Restart the file manager (e.g. `nautilus -q`, `nemo -q`).');
        log('Thunar has no file-based hook: Edit → Configure custom actions → add command:  "' + cmd + '" bookmarks add --notify %F');
      } else if (P === 'win32') {
        for (const base of ['*', 'Directory']) {
          const k = `HKCU\\Software\\Classes\\${base}\\shell\\DevDock`;
          execFileSync('reg', ['add', k, '/ve', '/d', 'Save Bookmark to DevDock', '/f']); execFileSync('reg', ['add', k + '\\command', '/ve', '/d', `"${cmd}" bookmarks add --notify "%1"`, '/f']);
        }
        log('Installed Explorer context-menu entries (current user). On Windows 11 they appear under "Show more options".');
      } else if (P === 'darwin') {
        const w = f.mac, script = `for f in "$@"; do "${cmd}" bookmarks add --notify "$f"; done`;
        write(path.join(w, 'Contents/Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>NSServices</key><array><dict><key>NSMenuItem</key><dict><key>default</key><string>Save Bookmark to DevDock</string></dict><key>NSMessage</key><string>runWorkflowAsService</string><key>NSRequiredContext</key><dict><key>NSApplicationIdentifier</key><string>com.apple.finder</string></dict><key>NSSendFileTypes</key><array><string>public.item</string></array></dict></array></dict></plist>\n`);
        write(path.join(w, 'Contents/document.wflow'), `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>AMApplicationBuild</key><string>523</string><key>AMApplicationVersion</key><string>2.10</string><key>AMDocumentVersion</key><string>2</string><key>actions</key><array><dict><key>action</key><dict><key>AMAccepts</key><dict><key>Container</key><string>List</string><key>Optional</key><true/><key>Types</key><array><string>com.apple.cocoa.string</string></array></dict><key>AMActionVersion</key><string>2.0.3</string><key>AMApplication</key><array><string>Automator</string></array><key>AMParameterProperties</key><dict><key>COMMAND_STRING</key><dict/><key>inputMethod</key><dict/><key>shell</key><dict/><key>source</key><dict/></dict><key>ActionBundlePath</key><string>/System/Library/Automator/Run Shell Script.action</string><key>ActionName</key><string>Run Shell Script</string><key>ActionParameters</key><dict><key>COMMAND_STRING</key><string>${xml(script)}</string><key>CheckedForUserDefaultShell</key><true/><key>inputMethod</key><integer>1</integer><key>shell</key><string>/bin/bash</string><key>source</key><string></string></dict><key>BundleIdentifier</key><string>com.apple.RunShellScript</string><key>CFBundleVersion</key><string>2.0.3</string><key>CanShowSelectedItemsWhenRun</key><false/><key>CanShowWhenRun</key><true/><key>Category</key><array><string>AMCategoryUtilities</string></array><key>Class Name</key><string>RunShellScriptAction</string><key>InputUUID</key><string>5B0C7E10-0A5F-4C47-9A3B-1D2E3F405161</string><key>OutputUUID</key><string>6C1D8F21-1B60-4D58-8B4C-2E3F40516272</string><key>UUID</key><string>7D2E9032-2C71-4E69-9C5D-3F4051627383</string><key>UnlocalizedApplications</key><array><string>Automator</string></array><key>arguments</key><dict/><key>isViewVisible</key><true/><key>location</key><string>309.000000:253.000000</string><key>nibPath</key><string>/System/Library/Automator/Run Shell Script.action/Contents/Resources/Base.lproj/main.nib</string></dict></dict></array><key>connectors</key><dict/><key>workflowMetaData</key><dict><key>applicationBundleIDsByPath</key><dict/><key>applicationPaths</key><array/><key>inputTypeIdentifier</key><string>com.apple.Automator.fileSystemObject</string><key>outputTypeIdentifier</key><string>com.apple.Automator.nothing</string><key>presentationMode</key><integer>15</integer><key>processesInput</key><integer>0</integer><key>serviceInputTypeIdentifier</key><string>com.apple.Automator.fileSystemObject</string><key>serviceOutputTypeIdentifier</key><string>com.apple.Automator.nothing</string><key>serviceProcessesInput</key><integer>0</integer><key>systemImageName</key><string>NSActionTemplate</string><key>useAutomaticInputType</key><integer>0</integer><key>workflowTypeIdentifier</key><string>com.apple.Automator.servicesMenu</string></dict></dict></plist>\n`);
        log('Installed Finder Quick Action. Enable it under System Settings → Keyboard → Keyboard Shortcuts → Services → Files and Folders. (Generated without a Mac to test: if it does not show, create it by hand in Automator with a "Run Shell Script" action.)');
      }
    },
    uninstall() {
      const f = this.files();
      if (P === 'linux') [f.nautilus, f.nemo, f.dolphin].forEach(p => log(rm(p) ? 'Removed ' + p : 'Not found: ' + p));
      else if (P === 'win32') for (const base of ['*', 'Directory']) { try { execFileSync('reg', ['delete', `HKCU\\Software\\Classes\\${base}\\shell\\DevDock`, '/f']); log('Removed registry entry for ' + base); } catch { log('No entry for ' + base); } }
      else if (P === 'darwin') log(rm(f.mac) ? 'Removed Quick Action' : 'Quick Action not found');
    }
  }
};
module.exports = async function run(action) {
  const names = { cli: 'command-line tool wrapper', vscode: 'VS Code extension', filemanager: 'file-manager "Save Bookmark to DevDock" entries' };
  for (const k of Object.keys(T)) {
    if (!want(k)) continue;
    if (!(await ask(`${action === 'install' ? 'Install' : 'Remove'} ${names[k]}?`))) { log('Skipped ' + k); continue; }
    try { await T[k][action](); } catch (e) { log(`${k}: failed — ${e.message}`); process.exitCode = 1; }
  }
};
