#!/usr/bin/env node
'use strict';
// devdock CLI: talks to the running app over a token-protected local socket (no network port).
// If the app is not running, read-only commands work straight from data.json.
const fs = require('fs'), path = require('path'), { spawn } = require('child_process');
const core = require('../core.js');

async function readStdin() { if (process.stdin.isTTY) return ''; let s = ''; process.stdin.setEncoding('utf8'); for await (const c of process.stdin) s += c; return s; }

(async () => {
  let args = process.argv.slice(2);
  if (args[0] === 'export' && args[1]) args[1] = path.resolve(args[1]); // resolve relative to the caller's cwd
  const boot = core.bootDir(); let rt = null;
  try { rt = JSON.parse(fs.readFileSync(path.join(boot, 'runtime.json'), 'utf8')); } catch { /* never started */ }
  const wantsStdin = args[0] === 'snippets' && args[1] === 'add';
  const stdin = wantsStdin ? await readStdin() : '';
  if (rt) {
    try {
      const r = await core.request(rt.socket, rt.token, args, stdin);
      if (r.out) process.stdout.write(r.out.endsWith('\n') ? r.out : r.out + '\n');
      process.exit(r.ok ? 0 : 1);
    } catch { /* app not running → offline mode below */ }
  }
  const dataFile = path.join(rt && rt.dataDir || path.join(boot, 'data'), 'data.json');
  const guiCmd = !args.length || ['open', 'dashboard'].includes(args[0]);
  if (guiCmd && rt && rt.launch) {
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; // wrapper runs the Electron binary as plain Node; the GUI must not inherit that
    spawn(rt.launch.cmd, rt.launch.args, { detached: true, stdio: 'ignore', env }).unref();
    console.log('Starting DevDock…'); return process.exit(0);
  }
  const r = core.offline(args, dataFile);
  console.log(r.out); process.exit(r.ok ? 0 : 1);
})();
