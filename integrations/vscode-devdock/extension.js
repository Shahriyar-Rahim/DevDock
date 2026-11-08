'use strict';
const vscode = require('vscode'), net = require('net'), fs = require('fs'), os = require('os'), path = require('path');

function call(args, stdin = '') {
  return new Promise((res, rej) => {
    let rt; try { rt = JSON.parse(fs.readFileSync(path.join(process.env.DEVDOCK_HOME || path.join(os.homedir(), '.devdock'), 'runtime.json'), 'utf8')); } catch { return rej(new Error('DevDock has not been started yet')); }
    const c = net.createConnection(rt.socket); let buf = ''; c.setEncoding('utf8');
    const t = setTimeout(() => { c.destroy(); rej(new Error('DevDock did not respond')); }, 10000);
    c.on('connect', () => c.write(JSON.stringify({ token: rt.token, args, stdin }) + '\n'));
    c.on('data', d => { buf += d; });
    c.on('end', () => { clearTimeout(t); try { const r = JSON.parse(buf.trim()); r.ok ? res(r.out) : rej(new Error(r.out)); } catch (e) { rej(e); } });
    c.on('error', () => { clearTimeout(t); rej(new Error('DevDock is not running — start it first')); });
  });
}
async function pickAndInsert(list) {
  if (!list.length) return vscode.window.showInformationMessage('No matching DevDock snippets');
  const p = await vscode.window.showQuickPick(list.map(s => ({ label: s.title, description: `${s.language} · ${s.category}`, detail: (s.tags || []).join(', '), id: s.id })), { placeHolder: 'Choose a snippet to insert', matchOnDetail: true });
  if (!p) return; const code = await call(['snippets', 'get', p.id]); const ed = vscode.window.activeTextEditor;
  if (ed) await ed.edit(b => ed.selections.forEach(s => b.replace(s, code.replace(/\n$/, ''))));
}
function activate(ctx) {
  const reg = (id, fn) => ctx.subscriptions.push(vscode.commands.registerCommand(id, async () => { try { await fn(); } catch (e) { vscode.window.showErrorMessage('DevDock: ' + e.message); } }));
  reg('devdock.saveSelection', async () => {
    const ed = vscode.window.activeTextEditor; if (!ed) return; const code = ed.document.getText(ed.selection); if (!code.trim()) return;
    const title = await vscode.window.showInputBox({ prompt: 'Snippet title', value: path.basename(ed.document.fileName) }); if (!title) return;
    const cat = await vscode.window.showInputBox({ prompt: 'Category', value: 'General' });
    await call(['snippets', 'add', '--title', title, '--lang', ed.document.languageId, '--category', cat || 'General'], code);
    vscode.window.showInformationMessage('Saved to DevDock: ' + title);
  });
  reg('devdock.insertSnippet', async () => pickAndInsert(JSON.parse(await call(['snippets', 'list', '--json']))));
  reg('devdock.searchSnippets', async () => { const q = await vscode.window.showInputBox({ prompt: 'Search DevDock snippets' }); if (q) await pickAndInsert(JSON.parse(await call(['snippets', 'search', q, '--json']))); });
  reg('devdock.openPicker', async () => { await call(['snippets', 'picker']); });
}
module.exports = { activate, deactivate() { } };
