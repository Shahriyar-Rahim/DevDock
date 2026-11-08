"use strict";
const {
  app,
  BrowserWindow,
  ipcMain,
  clipboard,
  shell,
  Tray,
  Menu,
  globalShortcut,
  nativeTheme,
  dialog,
  screen,
  nativeImage,
  Notification,
} = require("electron");
const path = require("path"),
  fs = require("fs"),
  os = require("os"),
  zlib = require("zlib"),
  crypto = require("crypto");
const { execFile } = require("child_process");
const core = require("./core.js");
const { DEF, DEF_SHORTCUTS, WIDGET_KINDS, uid, str, fb } = core;

const BOOT = core.bootDir();
const bootCfg = () => {
  try {
    return JSON.parse(fs.readFileSync(path.join(BOOT, "config.json"), "utf8"));
  } catch {
    return {};
  }
};
let DIR,
  FILE,
  LOG,
  IMGDIR,
  data,
  saveT,
  logT,
  logs = [],
  cliServer,
  cliToken;
let mainWin,
  launcherWin,
  popupWin,
  tray,
  quitting = false,
  shortFails = {};
const widgetWins = {};
const webPrefs = {
  preload: path.join(__dirname, "preload.js"),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
};
const backupsDir = () => path.join(DIR, "backups");
const backupNow = (tag) => core.backupFile(FILE, backupsDir(), tag);

/* ---------- storage ---------- */
function initDirs() {
  let d = app.getPath("userData");
  const c = bootCfg();
  if (c.dataDir) {
    try {
      fs.mkdirSync(c.dataDir, { recursive: true });
      fs.accessSync(c.dataDir, fs.constants.W_OK);
      d = c.dataDir;
    } catch {
      /* fall back to default */
    }
  }
  DIR = d;
  FILE = path.join(DIR, "data.json");
  LOG = path.join(DIR, "system_log.json");
  IMGDIR = path.join(DIR, "clip-images");
  fs.mkdirSync(backupsDir(), { recursive: true });
  fs.mkdirSync(IMGDIR, { recursive: true });
}
function saveNow() {
  try {
    core.saveData(FILE, data);
  } catch (e) {
    console.error("save failed", e);
  }
}
function save() {
  clearTimeout(saveT);
  saveT = setTimeout(saveNow, 250);
}
function broadcast(ch, p) {
  for (const w of BrowserWindow.getAllWindows())
    if (!w.isDestroyed()) w.webContents.send(ch, p);
}
function commit() {
  save();
  broadcast("state:changed", data);
}
function logEvent(type, msg) {
  logs.push({ t: Date.now(), type, msg });
  if (logs.length > data.settings.logRetention)
    logs = logs.slice(-data.settings.logRetention);
  clearTimeout(logT);
  logT = setTimeout(() => {
    try {
      fs.writeFileSync(LOG, JSON.stringify(logs));
    } catch {
      /* ignore */
    }
  }, 1000);
}
function notify(body) {
  try {
    new Notification({ title: "DevDock", body }).show();
  } catch {
    /* ignore */
  }
}
function copyDirData(from, to) {
  for (const n of ["data.json", "system_log.json"]) {
    const s = path.join(from, n);
    if (fs.existsSync(s) && !fs.existsSync(path.join(to, n)))
      fs.copyFileSync(s, path.join(to, n));
  }
  for (const sub of ["backups", "clip-images"]) {
    const s = path.join(from, sub);
    if (fs.existsSync(s))
      fs.cpSync(s, path.join(to, sub), { recursive: true, force: false });
  }
}
function relaunch() {
  clearTimeout(saveT);
  saveNow();
  quitting = true;
  app.relaunch();
  app.exit(0);
}

/* ---------- snippets & bookmarks ---------- */
function saveSnippet(s) {
  const ex = data.snippets.find((x) => x.id === (s && s.id));
  const o = core.sanitizeSnippet(s, ex);
  if (ex) Object.assign(ex, o);
  else data.snippets.unshift(o);
  commit();
  return o;
}
function saveBookmark(b) {
  const ex = data.bookmarks.find((x) => x.id === (b && b.id)),
    r = core.sanitizeBookmark(b, ex, data.bookmarks);
  if (!r.ok) return r;
  if (ex) Object.assign(ex, r.item);
  else data.bookmarks.unshift(r.item);
  commit();
  return { ok: true, item: r.item };
}
const inferType = (t) => {
  if (/^https?:\/\//i.test(t)) return "url";
  try {
    return fs.statSync(t).isDirectory() ? "folder" : "file";
  } catch {
    return "file";
  }
};

/* ---------- clipboard ---------- */
let lastClip = "",
  lastImg = "",
  clipTimer,
  clipBusy = false;
const rmImg = (c) => {
  if (c && c.file) {
    try {
      fs.unlinkSync(path.join(IMGDIR, path.basename(c.file)));
    } catch {
      /* ignore */
    }
  }
};
function setHistory(arr) {
  const keep = new Set(arr.map((c) => c.id));
  data.clipboard.history.forEach((c) => {
    if (!keep.has(c.id)) rmImg(c);
  });
  data.clipboard.history = arr;
}
function trimHistory() {
  const { kept } = core.pruneHistory(data.clipboard.history, data.settings);
  setHistory(kept);
}
function activeApp() {
  return new Promise((res) => {
    const t = { timeout: 2500, windowsHide: true };
    if (process.platform === "linux") {
      if (
        process.env.XDG_SESSION_TYPE === "wayland" ||
        (process.env.WAYLAND_DISPLAY && !process.env.DISPLAY)
      )
        return res(""); // Wayland: not detectable by design
      execFile(
        "xdotool",
        ["getactivewindow", "getwindowclassname"],
        t,
        (e, o) => {
          if (!e && o.trim()) return res(o.trim());
          execFile("xprop", ["-root", "_NET_ACTIVE_WINDOW"], t, (e2, o2) => {
            const id = e2 ? null : /(0x[0-9a-f]+)/i.exec(o2);
            if (!id) return res("");
            execFile("xprop", ["-id", id[1], "WM_CLASS"], t, (e3, o3) => {
              const m = e3 ? null : /"([^"]+)"\s*$/.exec(o3.trim());
              res(m ? m[1] : "");
            });
          });
        },
      );
    } else if (process.platform === "win32") {
      const ps =
        'Add-Type -Namespace W -Name U -MemberDefinition \'[DllImport("user32.dll")]public static extern IntPtr GetForegroundWindow();[DllImport("user32.dll")]public static extern uint GetWindowThreadProcessId(IntPtr h,out uint p);\';$p=0;[void][W.U]::GetWindowThreadProcessId([W.U]::GetForegroundWindow(),[ref]$p);(Get-Process -Id $p).ProcessName';
      execFile("powershell", ["-NoProfile", "-Command", ps], t, (e, o) =>
        res(e ? "" : o.trim()),
      );
    } else
      execFile(
        "osascript",
        [
          "-e",
          'tell application "System Events" to get name of first application process whose frontmost is true',
        ],
        t,
        (e, o) => res(e ? "" : o.trim()),
      );
  });
}
function writeClip(t) {
  clipboard.writeText(t);
  lastClip = t;
  lastImg = "";
  addClip(t, { source: "DevDock" });
}
function addClip(t, o = {}) {
  const s = data.settings;
  if (!t || t.length > 100000) return;
  if (s.sensitiveFilter && core.isSensitive(t)) return;
  if (core.isExcluded(t, o.source, s)) return;
  const h = data.clipboard.history,
    i = h.findIndex((c) => c.type !== "image" && c.text === t),
    old = i >= 0 ? h.splice(i, 1)[0] : null;
  h.unshift({
    id: uid(),
    text: t,
    type: core.clipType(t),
    time: Date.now(),
    pinned: old ? old.pinned : false,
    source: o.source || "",
  });
  trimHistory();
  commit();
}
function addImage(img, sig, source) {
  const s = data.settings,
    max = s.clipImageMaxMB * 1048576;
  if (core.isExcluded("", source, s)) return;
  const h = data.clipboard.history,
    i = h.findIndex((c) => c.sig === sig);
  if (i >= 0) {
    const c = h.splice(i, 1)[0];
    c.time = Date.now();
    h.unshift(c);
    commit();
    return;
  }
  let png = img.toPNG(),
    size = img.getSize();
  if (png.length > max) {
    img = img.resize({ width: Math.min(size.width, 1600) });
    png = img.toPNG();
    size = img.getSize();
    if (png.length > max) return;
  }
  const id = uid(),
    file = id + ".png";
  fs.writeFileSync(path.join(IMGDIR, file), png);
  h.unshift({
    id,
    type: "image",
    text: `Image ${size.width}×${size.height} (${fb(png.length)})`,
    file,
    sig,
    time: Date.now(),
    pinned: false,
    source: source || "",
  });
  trimHistory();
  commit();
}
async function pollClip() {
  if (clipBusy) return;
  const s = data.settings;
  let t = "",
    f = [];
  try {
    t = clipboard.readText();
    f = clipboard.availableFormats();
  } catch {
    return;
  }
  if (t && t !== lastClip) {
    lastClip = t;
    lastImg = "";
    clipBusy = true;
    const src = await activeApp();
    clipBusy = false;
    addClip(t, { source: src });
    return;
  }
  if (s.clipImages && !t && f.some((x) => x.startsWith("image/"))) {
    const img = clipboard.readImage();
    if (img.isEmpty()) return;
    const z = img.getSize();
    if (z.width * z.height > 3e7) return;
    const sig = crypto.createHash("sha1").update(img.toBitmap()).digest("hex");
    if (sig === lastImg) return;
    lastImg = sig;
    lastClip = "";
    clipBusy = true;
    const src = await activeApp();
    clipBusy = false;
    addImage(img, sig, src);
  }
}
function startClip() {
  clearInterval(clipTimer);
  clipTimer = null;
  if (!data.settings.clipEnabled) return;
  try {
    lastClip = clipboard.readText();
  } catch {
    lastClip = "";
  }
  clipTimer = setInterval(pollClip, 700); // Electron has no clipboard-change event on any platform
}

/* ---------- system monitor ---------- */
let prevCpu = null,
  prevNet = null,
  sys = null,
  sysTimer,
  lastWarn = {};
const hist = { cpu: [], ram: [], rx: [], tx: [] };
function cpuTimes() {
  return os.cpus().map((c) => {
    const t = c.times;
    return { idle: t.idle, total: t.user + t.nice + t.sys + t.idle + t.irq };
  });
}
function ramInfo() {
  const total = os.totalmem();
  let avail = os.freemem();
  if (process.platform === "linux") {
    try {
      const m = /MemAvailable:\s+(\d+)/.exec(
        fs.readFileSync("/proc/meminfo", "utf8"),
      );
      if (m) avail = +m[1] * 1024;
    } catch {
      /* ignore */
    }
  }
  return {
    total,
    free: os.freemem(),
    avail,
    used: total - avail,
    pct: Math.round((100 * (total - avail)) / total),
  };
}
function disks() {
  const roots =
      process.platform === "win32"
        ? "CDEFGHIJ".split("").map((l) => l + ":\\")
        : ["/"],
    out = [];
  for (const r of roots) {
    try {
      const s = fs.statfsSync(r),
        total = s.blocks * s.bsize,
        free = s.bavail * s.bsize;
      if (total)
        out.push({
          name: r,
          total,
          free,
          used: total - free,
          pct: Math.round((100 * (total - free)) / total),
        });
    } catch {
      /* ignore */
    }
  }
  return out;
}
function readNet() {
  return new Promise((res) => {
    try {
      if (process.platform === "linux") {
        let rx = 0,
          tx = 0;
        const ifs = [];
        for (const l of fs
          .readFileSync("/proc/net/dev", "utf8")
          .split("\n")
          .slice(2)) {
          const [n, rest] = l.split(":");
          if (!rest) continue;
          const name = n.trim();
          if (name === "lo") continue;
          const f = rest.trim().split(/\s+/);
          rx += +f[0];
          tx += +f[8];
          ifs.push(name);
        }
        return res({ rx, tx, iface: ifs.join(", ") });
      }
      if (process.platform === "darwin") {
        return execFile("netstat", ["-ib"], { timeout: 3000 }, (e, out) => {
          if (e) return res(null);
          let rx = 0,
            tx = 0;
          const seen = new Set();
          for (const l of out.split("\n")) {
            const c = l.trim().split(/\s+/);
            if (
              c[0] &&
              c[0].startsWith("en") &&
              /^<Link/.test(c[2] || "") &&
              !seen.has(c[0])
            ) {
              seen.add(c[0]);
              rx += +c[6] || 0;
              tx += +c[9] || 0;
            }
          }
          res({ rx, tx, iface: [...seen].join(", ") });
        });
      }
      execFile(
        "powershell",
        [
          "-NoProfile",
          "-Command",
          "Get-NetAdapterStatistics | Select-Object Name,ReceivedBytes,SentBytes | ConvertTo-Json",
        ],
        { timeout: 5000, windowsHide: true },
        (e, out) => {
          if (e) return res(null);
          try {
            let j = JSON.parse(out);
            if (!Array.isArray(j)) j = [j];
            res({
              rx: j.reduce((a, b) => a + b.ReceivedBytes, 0),
              tx: j.reduce((a, b) => a + b.SentBytes, 0),
              iface: j.map((x) => x.Name).join(", "),
            });
          } catch {
            res(null);
          }
        },
      );
    } catch {
      res(null);
    }
  });
}
const push = (a, v) => {
  a.push(v);
  if (a.length > 40) a.shift();
};
function warn(key, msg) {
  if (Date.now() - (lastWarn[key] || 0) > 60000) {
    lastWarn[key] = Date.now();
    logEvent("warning", msg);
  }
}
async function sample() {
  const t0 = Date.now(),
    s = data.settings,
    cur = cpuTimes(),
    cpu = core.cpuDelta(prevCpu, cur);
  prevCpu = cur;
  const ram = ramInfo(),
    dk = disks(),
    net = await readNet(),
    sp = core.netSpeed(prevNet, net, prevNet ? (t0 - prevNet.t) / 1000 : 0);
  if (net && prevNet && prevNet.iface !== net.iface)
    logEvent("network", "Interfaces changed: " + net.iface);
  if (net) prevNet = { ...net, t: t0 };
  push(hist.cpu, cpu.avg);
  push(hist.ram, ram.pct);
  push(hist.rx, sp.rxs);
  push(hist.tx, sp.txs);
  const pk = data.systemStats.peaks;
  if (cpu.avg > pk.cpu) {
    pk.cpu = cpu.avg;
    logEvent("peak", "New peak CPU " + cpu.avg + "%");
    save();
  }
  if (ram.pct > pk.ram) {
    pk.ram = ram.pct;
    logEvent("peak", "New peak RAM " + ram.pct + "%");
    save();
  }
  if (cpu.avg >= s.warnCpu) warn("cpu", "CPU at " + cpu.avg + "%");
  if (ram.pct >= s.warnRam) warn("ram", "RAM at " + ram.pct + "%");
  dk.forEach((d) => {
    if (d.pct >= s.warnDisk)
      warn("d" + d.name, `Storage ${d.name} at ${d.pct}%`);
  });
  const c0 = os.cpus()[0] || {};
  sys = {
    cpu,
    ram,
    disks: dk,
    net: {
      rxs: sp.rxs,
      txs: sp.txs,
      rx: net && net.rx,
      tx: net && net.tx,
      iface: net ? net.iface : "unavailable",
    },
    uptime: os.uptime(),
    model: c0.model || "CPU",
    cores: os.cpus().length,
    speed: c0.speed,
    hist,
    peaks: pk,
  };
  broadcast("sys:update", sys);
  sysTimer = setTimeout(sample, s.refreshMs);
}

/* ---------- icons ---------- */
function crc32(b) {
  let c = 0xffffffff;
  for (const x of b) {
    c ^= x;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (c ^ 0xffffffff) >>> 0;
}
function makeIcon(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size),
    r = size / 2;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const o = y * (size * 4 + 1) + 1 + x * 4,
        d = Math.hypot(x + 0.5 - r, y + 0.5 - r);
      if (d <= r - 0.5) {
        const i = d < r * 0.45;
        raw[o] = i ? 255 : 217;
        raw[o + 1] = i ? 243 : 154;
        raw[o + 2] = i ? 214 : 36;
        raw[o + 3] = 255;
      }
    }
  const chunk = (t, d) => {
    const l = Buffer.alloc(4);
    l.writeUInt32BE(d.length);
    const td = Buffer.concat([Buffer.from(t), d]),
      c = Buffer.alloc(4);
    c.writeUInt32BE(crc32(td));
    return Buffer.concat([l, td, c]);
  };
  const ih = Buffer.alloc(13);
  ih.writeUInt32BE(size, 0);
  ih.writeUInt32BE(size, 4);
  ih[8] = 8;
  ih[9] = 6;
  return nativeImage.createFromBuffer(
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk("IHDR", ih),
      chunk("IDAT", zlib.deflateSync(raw)),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
}

/* ---------- windows ---------- */
function loadView(win, view, extra = {}) {
  win.loadFile(path.join(__dirname, "index.html"), {
    query: { view, ...extra },
  });
}
function showMain(page, id, user) {
  if (mainWin && !mainWin.isDestroyed()) {
    mainWin.show();
    mainWin.focus();
    mainWin.webContents.send("nav", { page, id });
    return;
  }
  mainWin = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 820,
    minHeight: 560,
    show: false,
    title: "DevDock",
    backgroundColor: "#FAF8F3",
    icon: makeIcon(64),
    webPreferences: webPrefs,
  });
  mainWin.setMenuBarVisibility(false);
  loadView(mainWin, "main", {
    page:
      page ||
      (data.settings.restoreLastPage ? data.settings.lastPage : "dashboard"),
    id: id || "",
  });
  mainWin.once("ready-to-show", () => {
    if (user || !data.settings.startMinimized) mainWin.show();
  });
  mainWin.on("minimize", (e) => {
    if (data.settings.minimizeToTray) {
      e.preventDefault();
      mainWin.hide();
    }
  });
  mainWin.on("close", (e) => {
    if (!quitting && data.settings.closeToTray) {
      e.preventDefault();
      mainWin.hide();
    }
  });
  mainWin.on("closed", () => {
    mainWin = null;
  });
}
function toggleLauncher(on) {
  if (!on) {
    if (launcherWin && !launcherWin.isDestroyed()) launcherWin.close();
    return;
  }
  if (launcherWin && !launcherWin.isDestroyed()) return;
  const wa = screen.getPrimaryDisplay().workArea,
    p = data.launcherPos || {
      x: wa.x + wa.width - 260,
      y: wa.y + wa.height - 260,
    };
  launcherWin = new BrowserWindow({
    width: 240,
    height: 240,
    x: p.x,
    y: p.y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    webPreferences: webPrefs,
  });
  launcherWin.setAlwaysOnTop(true, "floating");
  loadView(launcherWin, "launcher");
  launcherWin.on("closed", () => {
    launcherWin = null;
  });
}
function openPopup(name, center) {
  if (popupWin && !popupWin.isDestroyed()) popupWin.close();
  const W = name === "system" ? 360 : 380,
    H = 480;
  let x, y;
  if (!center && launcherWin && !launcherWin.isDestroyed()) {
    const b = launcherWin.getBounds(),
      wa = screen.getDisplayMatching(b).workArea;
    x = b.x - W - 8 < wa.x ? b.x + b.width + 8 : b.x - W - 8;
    y = Math.min(Math.max(b.y + b.height - H, wa.y), wa.y + wa.height - H);
  } else {
    const wa = screen.getDisplayNearestPoint(
      screen.getCursorScreenPoint(),
    ).workArea;
    x = wa.x + Math.round((wa.width - W) / 2);
    y = wa.y + Math.round((wa.height - H) / 2);
  }
  const w = (popupWin = new BrowserWindow({
    width: W,
    height: H,
    x: Math.round(x),
    y: Math.round(y),
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    webPreferences: webPrefs,
    backgroundColor: "#FAF8F3",
  }));
  loadView(w, name);
  setTimeout(() => {
    if (!w.isDestroyed())
      w.on("blur", () => {
        if (!w.isDestroyed()) w.close();
      });
  }, 600);
  w.on("closed", () => {
    if (popupWin === w) popupWin = null;
  });
}
function toggleWidget(kind, on) {
  const ex = widgetWins[kind];
  if (!on) {
    if (ex && !ex.isDestroyed()) ex.close();
    return;
  }
  if (ex && !ex.isDestroyed()) return;
  const idx = WIDGET_KINDS.indexOf(kind),
    big = kind === "combined",
    mid = ["clipboard", "snippets", "folders", "bookmarks"].includes(kind);
  const b = data.widgetBounds[kind] || {
    width: big ? 300 : mid ? 280 : 260,
    height: big ? 420 : mid ? 300 : 190,
    x: 40 + 28 * idx,
    y: 60 + 28 * idx,
  };
  const w = (widgetWins[kind] = new BrowserWindow({
    ...b,
    minWidth: 220,
    minHeight: 140,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    hasShadow: false,
    webPreferences: webPrefs,
  }));
  w.setOpacity(data.settings.opacity);
  loadView(w, "widget", { kind });
  const sv = () => {
    if (!w.isDestroyed()) {
      data.widgetBounds[kind] = w.getBounds();
      save();
    }
  };
  w.on("moved", sv);
  w.on("resized", sv);
  w.on("closed", () => {
    delete widgetWins[kind];
  });
}
function runAction(a) {
  ({
    open: () => showMain("dashboard", "", true),
    clipboard: () => openPopup("clipboard", true),
    picker: () => openPopup("snippets", true),
    system: () => openPopup("system", true),
    bookmarks: () => openPopup("files", true),
    launcher: () => {
      applySettings({ launcherEnabled: !data.settings.launcherEnabled });
      commit();
    },
  })[a]?.();
}
function regShortcuts() {
  globalShortcut.unregisterAll();
  shortFails = {};
  for (const [a, acc] of Object.entries(data.globalShortcuts)) {
    if (!acc) continue;
    try {
      if (!globalShortcut.register(acc, () => runAction(a)))
        shortFails[a] =
          "Could not register (already used by another app or the desktop environment)";
    } catch {
      shortFails[a] = "Invalid accelerator";
    }
  }
}
function buildTray() {
  if (!tray) {
    tray = new Tray(makeIcon(process.platform === "darwin" ? 18 : 32));
    tray.setToolTip("DevDock");
    tray.on("click", () => showMain("dashboard", "", true));
  }
  const s = data.settings,
    o = (p) => () => showMain(p, "", true);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open Dashboard", click: o("dashboard") },
      { label: "Open Clipboard", click: o("clipboard") },
      { label: "Open Snippets", click: o("snippets") },
      { label: "Open System Monitor", click: o("system") },
      { label: "Open Bookmarks", click: o("files") },
      { type: "separator" },
      {
        label: "Floating Launcher",
        type: "checkbox",
        checked: s.launcherEnabled,
        click: () => {
          applySettings({ launcherEnabled: !s.launcherEnabled });
          commit();
        },
      },
      {
        label: "Combined Widget",
        type: "checkbox",
        checked: s.widgets.combined,
        click: () => {
          applySettings({ widgets: { combined: !s.widgets.combined } });
          commit();
        },
      },
      {
        label: "Pause Clipboard Monitoring",
        type: "checkbox",
        checked: !s.clipEnabled,
        click: () => {
          applySettings({ clipEnabled: !s.clipEnabled });
          commit();
        },
      },
      { type: "separator" },
      {
        label: "Quit DevDock",
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
}
function applySettings(p) {
  const s = data.settings,
    old = { ...s, widgets: { ...s.widgets } };
  core.applySettingsPatch(s, p);
  if (s.theme !== old.theme)
    nativeTheme.themeSource =
      s.theme === "system" ? "system" : s.theme === "light" ? "light" : "dark";
  if (s.launchAtStartup !== old.launchAtStartup) {
    try {
      app.setLoginItemSettings({ openAtLogin: s.launchAtStartup });
    } catch {
      /* ignore */
    }
  }
  if (s.launcherEnabled !== old.launcherEnabled)
    toggleLauncher(s.launcherEnabled);
  WIDGET_KINDS.forEach((k) => {
    if (s.widgets[k] !== old.widgets[k]) toggleWidget(k, s.widgets[k]);
  });
  if (s.opacity !== old.opacity)
    Object.values(widgetWins).forEach(
      (w) => !w.isDestroyed() && w.setOpacity(s.opacity),
    );
  if (s.clipEnabled !== old.clipEnabled) {
    startClip();
    logEvent(
      "clipboard",
      s.clipEnabled
        ? "Clipboard monitoring resumed"
        : "Clipboard monitoring paused",
    );
  }
  if (s.refreshMs !== old.refreshMs) {
    clearTimeout(sysTimer);
    sample();
  }
  trimHistory();
  buildTray();
}

/* ---------- paste ---------- */
function sendPaste(cb) {
  if (process.platform === "linux") {
    if (
      process.env.XDG_SESSION_TYPE === "wayland" ||
      (process.env.WAYLAND_DISPLAY && !process.env.DISPLAY)
    )
      execFile("wtype", ["-M", "ctrl", "v", "-m", "ctrl"], (e) =>
        cb(
          e &&
            "Wayland: direct paste needs `wtype` (compositor must support virtual keyboard)",
        ),
      );
    else
      execFile("xdotool", ["key", "--clearmodifiers", "ctrl+v"], (e) =>
        cb(e && "Direct paste needs `xdotool` (X11)"),
      );
  } else if (process.platform === "win32")
    execFile(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        'Add-Type -AssemblyName System.Windows.Forms;[System.Windows.Forms.SendKeys]::SendWait("^v")',
      ],
      { windowsHide: true },
      (e) => cb(e && "PowerShell SendKeys failed"),
    );
  else
    execFile(
      "osascript",
      [
        "-e",
        'tell application "System Events" to keystroke "v" using command down',
      ],
      (e) =>
        cb(
          e &&
            "macOS: grant DevDock Accessibility permission to paste directly",
        ),
    );
}
function pasteText(text, delay = 250) {
  return new Promise((res) => {
    const prev = clipboard.readText();
    writeClip(text);
    setTimeout(
      () =>
        sendPaste((err) => {
          if (err) {
            notify(err + " - snippet copied instead.");
            return res({ ok: false, msg: err });
          }
          setTimeout(() => {
            clipboard.writeText(prev);
            lastClip = prev;
          }, 600);
          res({ ok: true });
        }),
      delay,
    );
  });
}

/* ---------- command runner (in-app terminal + external CLI) ---------- */
function sysCmd(b) {
  const S = sys;
  if (!S || !S.cpu) return "Sampling…";
  if (b === "cpu")
    return `${S.model}\n${S.cores} cores @ ${S.speed} MHz | ${S.cpu.avg}% | per-core: ${S.cpu.per.join(", ")}`;
  if (b === "ram")
    return `Used ${fb(S.ram.used)} / ${fb(S.ram.total)} (${S.ram.pct}%) | available ${fb(S.ram.avail)}`;
  if (b === "storage")
    return S.disks
      .map((d) => `${d.name} ${fb(d.used)} / ${fb(d.total)} (${d.pct}%)`)
      .join("\n");
  if (b === "network")
    return `${S.net.iface} | down ${fb(S.net.rxs)}/s | up ${fb(S.net.txs)}/s | total down ${fb(S.net.rx)} up ${fb(S.net.tx)}`;
  return `CPU ${S.cpu.avg}% | RAM ${S.ram.pct}% | uptime ${Math.floor(S.uptime / 3600)}h`;
}
async function cliRun(args, stdin = "", fromUI = false) {
  const t = args.map(String).slice();
  if (t[0] === "devdock") t.shift();
  const [a, b] = t,
    { pos, flags } = core.parseFlags(t.slice(2));
  const pre = core.dataCmd(t, data);
  if (pre !== undefined)
    return a === "status" && sys && sys.cpu
      ? `${pre} | CPU ${sys.cpu.avg}% | RAM ${sys.ram.pct}%`
      : pre;
  switch (a) {
    case undefined:
    case "open":
    case "dashboard":
      showMain("dashboard", "", true);
      return "Opened DevDock";
    case "help":
      return "Commands: open | dashboard | status | clipboard [list|clear] | snippets [list|search <q>|get <id>|copy <id>|insert <id> [--delay s]|add --title T [--lang L --category C --tags a,b] (code on stdin)] | bookmarks [list|add <path|url>... [--name N --category C]] | folders | system [cpu|ram|storage|network] | launcher | widget [cpu|ram|disk|net|clipboard|snippets|folders|bookmarks] | settings | backup | export <file> | quit";
    case "clipboard":
      if (b === "clear") {
        setHistory(data.clipboard.history.filter((c) => c.pinned));
        commit();
        return "Cleared (pinned kept)";
      }
      openPopup("clipboard", true);
      return "Opened clipboard history";
    case "snippets":
    case "snippet": {
      if (b === undefined) {
        showMain("snippets", "", true);
        return "Opened snippets";
      }
      if (b === "picker") {
        openPopup("snippets", true);
        return "Opened snippet picker";
      }
      if (b === "copy" || b === "insert") {
        const s = data.snippets.find((x) => x.id === pos[0]);
        if (!s) return "Snippet not found";
        if (b === "copy") {
          writeClip(s.code);
          return "Copied: " + s.title;
        }
        if (fromUI)
          return "insert only works from an external terminal (it pastes into the window you focus next)";
        const d = Math.min(30, Math.max(0, Number(flags.delay) || 2));
        pasteText(s.code, d * 1000);
        return `Pasting "${s.title}" in ${d}s — focus the target editor now`;
      }
      if (b === "add") {
        const code =
          stdin || (typeof flags.code === "string" ? flags.code : "");
        if (!code.trim())
          return "Nothing to save: pipe code on stdin or pass --code";
        const o = saveSnippet({
          title: flags.title || "Saved from CLI",
          language: flags.lang,
          category: flags.category || data.settings.defaultCategory,
          tags: String(flags.tags || "").split(","),
          code,
        });
        if (flags.notify) notify("Snippet saved: " + o.title);
        return `Saved snippet [${o.id}] ${o.title}`;
      }
      return "Unknown snippets command";
    }
    case "bookmarks": {
      if (b === "add") {
        if (!pos.length)
          return "Usage: devdock bookmarks add <path|url>... [--name N --category C]";
        const out = [];
        for (const p of pos) {
          const r = saveBookmark({
            name: pos.length === 1 ? flags.name : "",
            target: p,
            type: inferType(p),
            category: flags.category,
          });
          out.push(r.ok ? "Saved: " + r.item.name : `${p}: ${r.msg}`);
        }
        if (flags.notify) notify(out.join("\n").slice(0, 200));
        return out.join("\n");
      }
      showMain("files", "", true);
      return "Opened bookmarks";
    }
    case "system":
      return sysCmd(b);
    case "backup":
      return "Backup saved: " + backupNow("cli");
    case "export": {
      if (fromUI || !t[1])
        return "Usage (external terminal): devdock export <file>";
      fs.copyFileSync(FILE, path.resolve(t[1]));
      return "Exported to " + path.resolve(t[1]);
    }
    case "launcher":
      applySettings({ launcherEnabled: !data.settings.launcherEnabled });
      commit();
      return (
        "Launcher " + (data.settings.launcherEnabled ? "enabled" : "disabled")
      );
    case "widget": {
      const k = WIDGET_KINDS.includes(b) ? b : "combined";
      applySettings({ widgets: { [k]: !data.settings.widgets[k] } });
      commit();
      return `Widget ${k} ${data.settings.widgets[k] ? "enabled" : "disabled"}`;
    }
    case "settings":
      showMain("settings", "", true);
      return "Opened settings";
    case "quit":
      if (fromUI) return "Use the tray menu to quit";
      setTimeout(() => {
        quitting = true;
        app.quit();
      }, 150);
      return "Quitting DevDock";
    default:
      return `Command not recognized: ${a}. Type 'help'.`;
  }
}
function startCli() {
  cliToken = crypto.randomBytes(24).toString("hex");
  fs.mkdirSync(BOOT, { recursive: true, mode: 0o700 });
  const sock = core.sockPath(BOOT);
  cliServer = core.startCliServer(sock, cliToken, async (args, stdin) => ({
    ok: true,
    out: String(await cliRun(args, stdin)),
  }));
  cliServer.on("error", (e) => console.error("CLI server error", e.message));
  const rt = {
    socket: sock,
    token: cliToken,
    dataDir: DIR,
    pid: process.pid,
    launch: {
      cmd: process.execPath,
      args: app.isPackaged ? [] : [app.getAppPath()],
    },
  };
  fs.writeFileSync(path.join(BOOT, "runtime.json"), JSON.stringify(rt), {
    mode: 0o600,
  });
}

/* ---------- IPC ---------- */
const H = (c, f) => ipcMain.handle(c, (e, ...a) => f(e, ...a));
function registerIpc() {
  H("state:get", () => data);
  H("sys:get", () => sys);
  H("snip:save", (_, s) =>
    s && typeof s === "object" ? saveSnippet(s) : null,
  );
  H("snip:del", (_, id) => {
    data.snippets = data.snippets.filter((s) => s.id !== id);
    commit();
  });
  H("bm:save", (_, b) => saveBookmark(b));
  H("bm:del", (_, id) => {
    data.bookmarks = data.bookmarks.filter((b) => b.id !== id);
    commit();
  });
  H("bm:open", async (_, id) => {
    const b = data.bookmarks.find((x) => x.id === id);
    if (!b) return { ok: false, msg: "Not found" };
    let err = "";
    if (b.type === "url") {
      if (!/^https?:\/\//i.test(b.target))
        return { ok: false, msg: "Blocked URL" };
      await shell.openExternal(b.target);
    } else {
      if (!fs.existsSync(b.target))
        return { ok: false, msg: "Path not found on this system: " + b.target };
      err = await shell.openPath(b.target);
    }
    if (err) return { ok: false, msg: err };
    b.lastOpened = Date.now();
    commit();
    return { ok: true };
  });
  H("dialog:pick", async (e, dir) => {
    const r = await dialog.showOpenDialog(
      BrowserWindow.fromWebContents(e.sender),
      { properties: [dir ? "openDirectory" : "openFile"] },
    );
    return r.canceled ? "" : r.filePaths[0];
  });
  H("clip:del", (_, id) => {
    setHistory(data.clipboard.history.filter((c) => c.id !== id));
    commit();
  });
  H("clip:pin", (_, id) => {
    const c = data.clipboard.history.find((x) => x.id === id);
    if (c) {
      c.pinned = !c.pinned;
      commit();
    }
  });
  H("clip:clear", () => {
    setHistory(data.clipboard.history.filter((c) => c.pinned));
    commit();
  });
  H("clip:image", (_, id) => {
    const c = data.clipboard.history.find((x) => x.id === id && x.file);
    if (!c) return "";
    try {
      const i = nativeImage.createFromPath(
        path.join(IMGDIR, path.basename(c.file)),
      );
      return i.resize({ width: Math.min(260, i.getSize().width) }).toDataURL();
    } catch {
      return "";
    }
  });
  H("clip:copyImage", (_, id) => {
    const c = data.clipboard.history.find((x) => x.id === id && x.file);
    if (!c) return false;
    clipboard.writeImage(
      nativeImage.createFromPath(path.join(IMGDIR, path.basename(c.file))),
    );
    lastImg = c.sig || "";
    return true;
  });
  H("copy", (_, t) => {
    writeClip(str(t, 200000));
    return true;
  });
  H("paste", async (e, t) => {
    t = str(t, 200000);
    const w = BrowserWindow.fromWebContents(e.sender);
    if (w === mainWin) {
      writeClip(t);
      return {
        ok: false,
        msg: "Copied. Direct paste works from the picker/launcher popups.",
      };
    }
    if (w && !w.isDestroyed()) w.close();
    return pasteText(t);
  });
  H("settings:set", (_, p) => {
    if (p && typeof p === "object") {
      applySettings(p);
      commit();
    }
  });
  H("settings:reset", () => {
    backupNow("prereset");
    const keep = data.settings.lastPage;
    data.settings = DEF().settings;
    data.settings.lastPage = keep;
    data.globalShortcuts = { ...DEF_SHORTCUTS };
    nativeTheme.themeSource = "light";
    regShortcuts();
    toggleLauncher(false);
    WIDGET_KINDS.forEach((k) => toggleWidget(k, false));
    startClip();
    buildTray();
    commit();
  });
  H("appearance:reset", () => {
    const d = DEF().settings;
    for (const k of [
      "theme",
      "accent",
      "accent2",
      "colors",
      "font",
      "fontSize",
      "density",
      "radius",
      "shadow",
      "anim",
      "transparency",
      "opacity",
      "matrixIntensity",
      "reducedMotion",
    ])
      data.settings[k] = d[k];
    nativeTheme.themeSource = "light";
    commit();
  });
  H("shortcuts:set", (_, m) => {
    if (!m || typeof m !== "object") return {};
    const next = { ...data.globalShortcuts },
      seen = {},
      conflicts = {};
    for (const k of Object.keys(DEF_SHORTCUTS))
      if (typeof m[k] === "string") next[k] = m[k].slice(0, 60);
    for (const [k, v] of Object.entries(next)) {
      if (!v) continue;
      const n = v.toLowerCase();
      if (seen[n]) conflicts[k] = "Conflicts with " + seen[n];
      else seen[n] = k;
    }
    if (Object.keys(conflicts).length) return conflicts;
    data.globalShortcuts = next;
    regShortcuts();
    commit();
    return shortFails;
  });
  H("shortcuts:reset", () => {
    data.globalShortcuts = { ...DEF_SHORTCUTS };
    regShortcuts();
    commit();
    return shortFails;
  });
  H("shortcuts:fails", () => shortFails);
  H("win:open", (_, name, arg) => {
    if (name === "main")
      showMain(
        typeof arg === "object" && arg ? arg.page : arg,
        arg && arg.id,
        true,
      );
    else if (
      ["snippets", "system", "files", "clipboard", "recent"].includes(name)
    )
      openPopup(name, !launcherWin);
  });
  H("win:close", (e) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    if (w && w !== mainWin && !w.isDestroyed()) w.close();
  });
  H("launcher:move", (_, x, y) => {
    if (
      launcherWin &&
      !launcherWin.isDestroyed() &&
      Number.isFinite(x) &&
      Number.isFinite(y)
    )
      launcherWin.setPosition(Math.round(x), Math.round(y));
  });
  H("launcher:save", () => {
    if (launcherWin && !launcherWin.isDestroyed()) {
      const b = launcherWin.getBounds();
      data.launcherPos = { x: b.x, y: b.y };
      save();
    }
  });
  H("data:export", async () => {
    const r = await dialog.showSaveDialog({
      defaultPath: "devdock-export.json",
    });
    if (r.canceled) return "";
    fs.writeFileSync(r.filePath, JSON.stringify(data, null, 2));
    return r.filePath;
  });
  const importFrom = (f) => {
    const j = JSON.parse(fs.readFileSync(f, "utf8"));
    if (!j || typeof j !== "object" || !Array.isArray(j.snippets))
      throw new Error("Not a DevDock data file");
    backupNow("preimport");
    data = core.migrate(core.merge(DEF(), j));
    regShortcuts();
    startClip();
    buildTray();
    toggleLauncher(data.settings.launcherEnabled);
    WIDGET_KINDS.forEach((k) => toggleWidget(k, data.settings.widgets[k]));
    commit();
  };
  H("data:import", async () => {
    const r = await dialog.showOpenDialog({
      properties: ["openFile"],
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (r.canceled) return { ok: false };
    try {
      importFrom(r.filePaths[0]);
      return { ok: true };
    } catch (e) {
      return { ok: false, msg: e.message };
    }
  });
  H("data:backup", () => backupNow("manual") || "");
  H("data:restore", async () => {
    const r = await dialog.showOpenDialog({
      defaultPath: backupsDir(),
      properties: ["openFile"],
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (r.canceled) return { ok: false };
    try {
      importFrom(r.filePaths[0]);
      return { ok: true };
    } catch (e) {
      return { ok: false, msg: e.message };
    }
  });
  H("data:clear", (_, k) => {
    backupNow("preclear");
    if (k === "snippets") data.snippets = [];
    else if (k === "clipboard") setHistory([]);
    else if (k === "bookmarks") data.bookmarks = [];
    else if (k === "log") {
      logs = [];
      fs.writeFileSync(LOG, "[]");
    } else if (k === "peaks") data.systemStats.peaks = { cpu: 0, ram: 0 };
    commit();
  });
  H("datadir:get", () => ({
    dir: DIR,
    def: app.getPath("userData"),
    custom: DIR !== app.getPath("userData"),
  }));
  H("datadir:set", async (e) => {
    const r = await dialog.showOpenDialog(
      BrowserWindow.fromWebContents(e.sender),
      { properties: ["openDirectory", "createDirectory"] },
    );
    if (r.canceled) return { ok: false };
    const to = r.filePaths[0];
    if (path.resolve(to) === path.resolve(DIR))
      return { ok: false, msg: "Already using this folder" };
    try {
      fs.mkdirSync(to, { recursive: true });
      fs.accessSync(to, fs.constants.W_OK);
      saveNow();
      copyDirData(DIR, to);
      fs.mkdirSync(BOOT, { recursive: true });
      fs.writeFileSync(
        path.join(BOOT, "config.json"),
        JSON.stringify({ ...bootCfg(), dataDir: to }),
      );
    } catch (err) {
      return { ok: false, msg: err.message };
    }
    setTimeout(relaunch, 300);
    return { ok: true };
  });
  H("datadir:reset", () => {
    const def = app.getPath("userData");
    try {
      saveNow();
      copyDirData(DIR, def);
      const c = bootCfg();
      delete c.dataDir;
      fs.writeFileSync(path.join(BOOT, "config.json"), JSON.stringify(c));
    } catch (err) {
      return { ok: false, msg: err.message };
    }
    setTimeout(relaunch, 300);
    return { ok: true };
  });
  H("term:run", (_, l) =>
    cliRun(str(l, 400).trim().split(/\s+/).filter(Boolean), "", true),
  );
}

/* ---------- lifecycle ---------- */
if (!app.requestSingleInstanceLock()) app.quit();
app.on("second-instance", () => showMain("dashboard", "", true));
app.on("web-contents-created", (_, c) => {
  c.setWindowOpenHandler(() => ({ action: "deny" }));
  c.on("will-navigate", (e) => e.preventDefault());
});
app.whenReady().then(() => {
  initDirs();
  try {
    logs = JSON.parse(fs.readFileSync(LOG, "utf8"));
  } catch {
    logs = [];
  }
  const r = core.loadData(FILE, backupsDir());
  data = r.data;
  if (r.recovered)
    setTimeout(
      () =>
        notify(
          "Data file was corrupted — restored from the latest backup (or defaults).",
        ),
      2000,
    );
  nativeTheme.themeSource =
    data.settings.theme === "system"
      ? "system"
      : data.settings.theme === "light"
        ? "light"
        : "dark";
  registerIpc();
  buildTray();
  regShortcuts();
  startClip();
  logEvent("monitor", "Monitoring started");
  sample();
  startCli();
  showMain();
  if (data.settings.launcherEnabled) toggleLauncher(true);
  WIDGET_KINDS.forEach((k) => {
    if (data.settings.widgets[k]) toggleWidget(k, true);
  });
  setInterval(() => {
    trimHistory();
    commit();
  }, 3600000);
});
app.on("window-all-closed", () => {
  if (!tray || !data.settings.closeToTray) app.quit();
});
app.on("before-quit", () => {
  quitting = true;
  globalShortcut.unregisterAll();
  logEvent("monitor", "Monitoring stopped");
  clearInterval(clipTimer);
  clearTimeout(sysTimer);
  try {
    cliServer && cliServer.close();
    if (process.platform !== "win32") fs.unlinkSync(core.sockPath(BOOT));
  } catch {
    /* ignore */
  }
  saveNow();
  try {
    fs.writeFileSync(LOG, JSON.stringify(logs));
  } catch {
    /* ignore */
  }
});
