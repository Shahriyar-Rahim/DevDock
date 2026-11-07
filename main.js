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
  zlib = require("zlib");
const { execFile } = require("child_process");

const SCHEMA = 1;
const DEF_SHORTCUTS = {
  open: "CommandOrControl+Shift+D",
  clipboard: "CommandOrControl+Shift+V",
  picker: "CommandOrControl+Shift+S",
  launcher: "CommandOrControl+Shift+Space",
  system: "CommandOrControl+Shift+M",
  bookmarks: "CommandOrControl+Shift+B",
};
const DEF = () => ({
  schemaVersion: SCHEMA,
  settings: {
    theme: "light",
    accent: "",
    accent2: "",
    colors: {},
    font: "system-ui",
    fontSize: 14,
    density: "normal",
    radius: 10,
    shadow: 1,
    anim: 1,
    transparency: 1,
    opacity: 1,
    matrixIntensity: 0.5,
    reducedMotion: false,
    minimizeToTray: true,
    closeToTray: true,
    startMinimized: false,
    launchAtStartup: false,
    launcherEnabled: false,
    widgetEnabled: false,
    restoreLastPage: true,
    confirmDelete: true,
    lastPage: "dashboard",
    alwaysPaste: false,
    defaultLanguage: "JavaScript",
    defaultCategory: "General",
    copyNotify: true,
    suggestClipSnippet: true,
    clipEnabled: true,
    clipMax: 100,
    clipRetentionDays: 7,
    clipExclude: "",
    sensitiveFilter: true,
    refreshMs: 2000,
    dashMetrics: ["cpu", "ram", "disk", "net"],
    warnCpu: 90,
    warnRam: 90,
    warnDisk: 90,
    logRetention: 500,
    hoverMs: 1500,
  },
  systemStats: { peaks: { cpu: 0, ram: 0 } },
  snippets: [],
  clipboard: { history: [] },
  bookmarks: [],
  globalShortcuts: { ...DEF_SHORTCUTS },
  launcherPos: null,
  widgetBounds: null,
  recentItems: [],
});
const CLAMP = {
  fontSize: [10, 22],
  radius: [0, 24],
  shadow: [0, 3],
  anim: [0, 3],
  transparency: [0.5, 1],
  opacity: [0.3, 1],
  matrixIntensity: [0, 1],
  clipMax: [10, 1000],
  clipRetentionDays: [1, 365],
  refreshMs: [500, 60000],
  warnCpu: [10, 100],
  warnRam: [10, 100],
  warnDisk: [10, 100],
  logRetention: [50, 5000],
  hoverMs: [500, 5000],
};
const ENUMS = {
  theme: ["light", "dark", "system", "matrix"],
  density: ["compact", "normal", "comfortable"],
};

let DIR,
  FILE,
  LOG,
  data,
  saveT,
  logT,
  logs = [];
let mainWin,
  launcherWin,
  popupWin,
  widgetWin,
  tray,
  quitting = false,
  shortFails = {};
const webPrefs = {
  preload: path.join(__dirname, "preload.js"),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: false,
};
const uid = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const str = (v, n = 500) => (typeof v === "string" ? v.slice(0, n) : "");
const tagsOf = (v) =>
  (Array.isArray(v) ? v : [])
    .map((t) => str(t, 40).trim())
    .filter(Boolean)
    .slice(0, 20);

/* ---------- storage ---------- */
function merge(d, s) {
  for (const k in s) {
    if (
      s[k] &&
      typeof s[k] === "object" &&
      !Array.isArray(s[k]) &&
      d[k] &&
      typeof d[k] === "object" &&
      !Array.isArray(d[k])
    )
      merge(d[k], s[k]);
    else d[k] = s[k];
  }
  return d;
}
const backupsDir = () => path.join(DIR, "backups");
function backupNow(tag = "manual") {
  if (!fs.existsSync(FILE)) return null;
  const f = path.join(backupsDir(), `data-${tag}-${Date.now()}.json`);
  fs.copyFileSync(FILE, f);
  return f;
}
function latestBackup() {
  try {
    const l = fs
      .readdirSync(backupsDir())
      .filter((f) => f.endsWith(".json"))
      .sort();
    return l.length ? path.join(backupsDir(), l[l.length - 1]) : null;
  } catch {
    return null;
  }
}
function load() {
  try {
    if (!fs.existsSync(FILE)) return DEF();
    const raw = JSON.parse(fs.readFileSync(FILE, "utf8"));
    if ((raw.schemaVersion || 0) < SCHEMA) backupNow("premigrate");
    const d = merge(DEF(), raw);
    d.schemaVersion = SCHEMA;
    return d;
  } catch (e) {
    try {
      fs.renameSync(FILE, FILE + ".corrupt-" + Date.now());
    } catch {
      /* ignore */
    }
    const b = latestBackup();
    if (b) {
      try {
        return merge(DEF(), JSON.parse(fs.readFileSync(b, "utf8")));
      } catch {
        /* ignore */
      }
    }
    return DEF();
  }
}
function saveNow() {
  try {
    const t = FILE + ".tmp";
    fs.writeFileSync(t, JSON.stringify(data, null, 2));
    fs.renameSync(t, FILE);
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
  const max = data.settings.logRetention;
  if (logs.length > max) logs = logs.slice(-max);
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

/* ---------- clipboard ---------- */
let lastClip = "",
  clipTimer;
const SENSITIVE = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b(password|passwd|pwd|secret|api[_-]?key|token)\s*[:=]\s*\S+/i,
  /^(sk-|ghp_|gho_|xox[baprs]-|AKIA)[A-Za-z0-9_\-]{12,}/,
  /^eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}$/,
];
function clipType(t) {
  if (/^https?:\/\/\S+$/.test(t.trim())) return "url";
  if (
    /[{};]|=>|\b(function|def|class|import|return|#include)\b/.test(t) &&
    (t.includes("\n") || /[;{}]/.test(t))
  )
    return "code";
  return "text";
}
function writeClip(t) {
  clipboard.writeText(t);
  lastClip = t;
  addClip(t);
}
function addClip(t) {
  const s = data.settings;
  if (!t || t.length > 100000) return;
  if (s.sensitiveFilter && SENSITIVE.some((r) => r.test(t))) return;
  const ex = s.clipExclude
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
  if (ex.some((x) => t.toLowerCase().includes(x))) return;
  const h = data.clipboard.history;
  const i = h.findIndex((c) => c.text === t);
  const old = i >= 0 ? h.splice(i, 1)[0] : null;
  h.unshift({
    id: uid(),
    text: t,
    type: clipType(t),
    time: Date.now(),
    pinned: old ? old.pinned : false,
  });
  pruneClip();
  commit();
}
function pruneClip() {
  const s = data.settings,
    cut = Date.now() - s.clipRetentionDays * 864e5;
  let n = 0;
  data.clipboard.history = data.clipboard.history.filter(
    (c) => c.pinned || (c.time > cut && ++n <= s.clipMax),
  );
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
  // Electron exposes no clipboard-change event on any platform, so a light 700ms text poll is used.
  clipTimer = setInterval(() => {
    let t = "";
    try {
      t = clipboard.readText();
    } catch {
      return;
    }
    if (t && t !== lastClip) {
      lastClip = t;
      addClip(t);
    }
  }, 700);
}

/* ---------- system monitor ---------- */
let prevCpu = null,
  prevNet = null,
  sys = null,
  sysTimer,
  lastWarn = {};
const hist = { cpu: [], ram: [], rx: [], tx: [] };
function cpuUsage() {
  const cur = os.cpus().map((c) => {
    const t = c.times;
    return { idle: t.idle, total: t.user + t.nice + t.sys + t.idle + t.irq };
  });
  let per = [];
  if (prevCpu && prevCpu.length === cur.length)
    per = cur.map((c, i) => {
      const dt = c.total - prevCpu[i].total,
        di = c.idle - prevCpu[i].idle;
      return dt > 0 ? Math.round((100 * (dt - di)) / dt) : 0;
    });
  prevCpu = cur;
  return {
    avg: per.length
      ? Math.round(per.reduce((a, b) => a + b, 0) / per.length)
      : 0,
    per,
  };
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
      : ["/"];
  const out = [];
  for (const r of roots) {
    try {
      const s = fs.statfsSync(r);
      const total = s.blocks * s.bsize,
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
    s = data.settings;
  const cpu = cpuUsage(),
    ram = ramInfo(),
    dk = disks(),
    net = await readNet();
  let rxs = 0,
    txs = 0;
  if (net && prevNet) {
    const dt = (t0 - prevNet.t) / 1000;
    if (dt > 0) {
      rxs = Math.max(0, (net.rx - prevNet.rx) / dt);
      txs = Math.max(0, (net.tx - prevNet.tx) / dt);
    }
    if (prevNet.iface !== net.iface)
      logEvent("network", "Interfaces changed: " + net.iface);
  }
  if (net) prevNet = { ...net, t: t0 };
  push(hist.cpu, cpu.avg);
  push(hist.ram, ram.pct);
  push(hist.rx, rxs);
  push(hist.tx, txs);
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
      rxs,
      txs,
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
function startSys() {
  clearTimeout(sysTimer);
  logEvent("monitor", "Monitoring started");
  sample();
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
        const inner = d < r * 0.45;
        raw[o] = inner ? 255 : 217;
        raw[o + 1] = inner ? 243 : 154;
        raw[o + 2] = inner ? 214 : 36;
        raw[o + 3] = 255;
      }
    }
  const chunk = (t, d) => {
    const l = Buffer.alloc(4);
    l.writeUInt32BE(d.length);
    const td = Buffer.concat([Buffer.from(t), d]);
    const c = Buffer.alloc(4);
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
function showMain(page, id) {
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
  mainWin.webContents.openDevTools();
  mainWin.once("ready-to-show", () => {
    if (!(data.settings.startMinimized && !mainWin.__userOpen)) mainWin.show();
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
function toggleWidget(on) {
  if (!on) {
    if (widgetWin && !widgetWin.isDestroyed()) widgetWin.close();
    return;
  }
  if (widgetWin && !widgetWin.isDestroyed()) return;
  const b = data.widgetBounds || { width: 300, height: 420, x: 40, y: 60 };
  widgetWin = new BrowserWindow({
    ...b,
    minWidth: 240,
    minHeight: 260,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    hasShadow: false,
    webPreferences: webPrefs,
  });
  widgetWin.setOpacity(data.settings.opacity);
  loadView(widgetWin, "widget");
  const sv = () => {
    if (!widgetWin.isDestroyed()) {
      data.widgetBounds = widgetWin.getBounds();
      save();
    }
  };
  widgetWin.on("moved", sv);
  widgetWin.on("resized", sv);
  widgetWin.on("closed", () => {
    widgetWin = null;
  });
}
function runAction(a) {
  const m = {
    open: () => showMain("dashboard"),
    clipboard: () => openPopup("clipboard", true),
    picker: () => openPopup("snippets", true),
    system: () => openPopup("system", true),
    bookmarks: () => openPopup("files", true),
    launcher: () => {
      applySettings({ launcherEnabled: !data.settings.launcherEnabled });
      commit();
    },
  };
  if (m[a]) m[a]();
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
    tray.on("click", () => showMain("dashboard"));
  }
  const s = data.settings;
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open Dashboard", click: () => showMain("dashboard") },
      { label: "Open Clipboard", click: () => showMain("clipboard") },
      { label: "Open Snippets", click: () => showMain("snippets") },
      { label: "Open System Monitor", click: () => showMain("system") },
      { label: "Open Bookmarks", click: () => showMain("files") },
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
        label: "Desktop Widget",
        type: "checkbox",
        checked: s.widgetEnabled,
        click: () => {
          applySettings({ widgetEnabled: !s.widgetEnabled });
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

/* ---------- settings ---------- */
function applySettings(p) {
  const d = DEF().settings,
    s = data.settings,
    old = { ...s };
  for (const k in p) {
    if (!(k in d)) continue;
    let v = p[k];
    if (k === "colors") {
      s.colors = {};
      for (const c of ["bg", "sidebar", "card", "text", "border"])
        if (v && /^#[0-9a-f]{6}$/i.test(v[c] || "")) s.colors[c] = v[c];
      continue;
    }
    if (k === "dashMetrics") {
      if (Array.isArray(v))
        s[k] = v.filter((x) => ["cpu", "ram", "disk", "net"].includes(x));
      continue;
    }
    if (k === "accent" || k === "accent2") {
      if (v === "" || /^#[0-9a-f]{6}$/i.test(v)) s[k] = v;
      continue;
    }
    if (typeof v !== typeof d[k]) continue;
    if (typeof v === "string") v = v.slice(0, 200);
    if (ENUMS[k] && !ENUMS[k].includes(v)) continue;
    if (CLAMP[k]) v = Math.min(CLAMP[k][1], Math.max(CLAMP[k][0], v));
    s[k] = v;
  }
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
  if (s.widgetEnabled !== old.widgetEnabled) toggleWidget(s.widgetEnabled);
  if (s.opacity !== old.opacity && widgetWin && !widgetWin.isDestroyed())
    widgetWin.setOpacity(s.opacity);
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
  pruneClip();
  buildTray();
}

/* ---------- paste ---------- */
function sendPaste(cb) {
  const done = (e) => cb(e);
  if (process.platform === "linux") {
    if (
      process.env.XDG_SESSION_TYPE === "wayland" ||
      (process.env.WAYLAND_DISPLAY && !process.env.DISPLAY)
    )
      execFile("wtype", ["-M", "ctrl", "v", "-m", "ctrl"], (e) =>
        done(
          e &&
            "Wayland: direct paste needs `wtype` (compositor must support virtual keyboard)",
        ),
      );
    else
      execFile("xdotool", ["key", "--clearmodifiers", "ctrl+v"], (e) =>
        done(e && "Direct paste needs `xdotool` (X11)"),
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
      (e) => done(e && "PowerShell SendKeys failed"),
    );
  else
    execFile(
      "osascript",
      [
        "-e",
        'tell application "System Events" to keystroke "v" using command down',
      ],
      (e) =>
        done(
          e &&
            "macOS: grant DevDock Accessibility permission to paste directly",
        ),
    );
}

/* ---------- terminal (allowlist) ---------- */
const fb = (n) => {
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  n = n || 0;
  while (n >= 1024 && i < 4) {
    n /= 1024;
    i++;
  }
  return n.toFixed(i ? 1 : 0) + " " + u[i];
};
function term(line) {
  const t = str(line, 300).trim().split(/\s+/).filter(Boolean);
  if (t[0] === "devdock") t.shift();
  const [a, b] = t,
    rest = t.slice(1).join(" ");
  const S = sys || {};
  switch (a) {
    case undefined:
    case "help":
      return "Commands: status | snippets list | snippets search <q> | snippets copy <id> | clipboard list | clipboard clear | bookmarks list | folders | system [cpu|ram|storage|network] | backup | export | settings | launcher | widget | clear";
    case "status":
      return `DevDock OK | snippets ${data.snippets.length} | clips ${data.clipboard.history.length} | bookmarks ${data.bookmarks.length} | CPU ${S.cpu ? S.cpu.avg : "?"}% | RAM ${S.ram ? S.ram.pct : "?"}% | clipboard ${data.settings.clipEnabled ? "on" : "paused"}`;
    case "snippets":
    case "snippet": {
      if (b === "list" || !b)
        return (
          data.snippets
            .map((s) => `[${s.id}] ${s.title} (${s.language})`)
            .join("\n") || "No snippets"
        );
      if (b === "search") {
        const q = t.slice(2).join(" ").toLowerCase();
        return (
          data.snippets
            .filter((s) =>
              (s.title + s.code + s.tags.join(" ")).toLowerCase().includes(q),
            )
            .map((s) => `[${s.id}] ${s.title}`)
            .join("\n") || "No matches"
        );
      }
      if (b === "copy") {
        const s = data.snippets.find((x) => x.id === t[2]);
        if (!s) return "Snippet not found";
        writeClip(s.code);
        return "Copied: " + s.title;
      }
      return "Unknown snippets command";
    }
    case "clipboard":
    case "clip":
      if (b === "clear") {
        data.clipboard.history = data.clipboard.history.filter((c) => c.pinned);
        commit();
        return "Cleared (pinned kept)";
      }
      return (
        data.clipboard.history
          .slice(0, 15)
          .map(
            (c, i) => `${i + 1}. ${c.text.replace(/\s+/g, " ").slice(0, 70)}`,
          )
          .join("\n") || "Empty"
      );
    case "bookmarks":
    case "folders":
      return (
        data.bookmarks
          .filter((x) => a === "bookmarks" || x.type === "folder")
          .map((x) => `[${x.id}] ${x.name} -> ${x.target}`)
          .join("\n") || "None"
      );
    case "system":
      if (!S.cpu) return "Sampling...";
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
    case "backup":
      return "Backup saved: " + backupNow("cli");
    case "export":
      return "Use Settings > Data > Export (save dialog).";
    case "launcher":
      applySettings({ launcherEnabled: !data.settings.launcherEnabled });
      commit();
      return (
        "Launcher " + (data.settings.launcherEnabled ? "enabled" : "disabled")
      );
    case "widget":
      applySettings({ widgetEnabled: !data.settings.widgetEnabled });
      commit();
      return "Widget " + (data.settings.widgetEnabled ? "enabled" : "disabled");
    case "settings":
      return "Open Settings page from the sidebar.";
    default:
      return `Command not recognized: ${a}. Type 'help'.`;
  }
}

/* ---------- IPC ---------- */
const H = (c, f) => ipcMain.handle(c, (e, ...a) => f(e, ...a));
function registerIpc() {
  H("state:get", () => data);
  H("sys:get", () => sys);
  H("snip:save", (_, s) => {
    if (!s || typeof s !== "object") return null;
    const now = Date.now(),
      ex = data.snippets.find((x) => x.id === s.id);
    const o = {
      id: ex ? ex.id : uid(),
      title: str(s.title, 120).trim() || "Untitled",
      description: str(s.description, 1000),
      language: str(s.language, 40) || "Other",
      category: str(s.category, 60) || "General",
      tags: tagsOf(s.tags),
      code: str(s.code, 200000),
      favorite: !!s.favorite,
      created: ex ? ex.created : now,
      modified: now,
    };
    if (ex) Object.assign(ex, o);
    else data.snippets.unshift(o);
    commit();
    return o;
  });
  H("snip:del", (_, id) => {
    data.snippets = data.snippets.filter((s) => s.id !== id);
    commit();
  });
  H("bm:save", (_, b) => {
    if (!b || typeof b !== "object") return { ok: false, msg: "Invalid" };
    const type = ["folder", "file", "url"].includes(b.type) ? b.type : "folder",
      target = str(b.target, 2000).trim();
    if (
      type === "url" ? !/^https?:\/\//i.test(target) : !path.isAbsolute(target)
    )
      return {
        ok: false,
        msg:
          type === "url"
            ? "URL must start with http(s)://"
            : "Path must be absolute",
      };
    const ex = data.bookmarks.find((x) => x.id === b.id);
    if (!ex && data.bookmarks.some((x) => x.target === target))
      return { ok: false, msg: "Already saved" };
    const o = {
      id: ex ? ex.id : uid(),
      name: str(b.name, 100).trim() || target,
      target,
      type,
      description: str(b.description, 500),
      tags: tagsOf(b.tags),
      category: str(b.category, 60) || "General",
      icon: str(b.icon, 4),
      color: /^#[0-9a-f]{6}$/i.test(b.color || "") ? b.color : "#D99A24",
      favorite: !!b.favorite,
      created: ex ? ex.created : Date.now(),
      lastOpened: ex ? ex.lastOpened : 0,
    };
    if (ex) Object.assign(ex, o);
    else data.bookmarks.unshift(o);
    commit();
    return { ok: true };
  });
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
    data.clipboard.history = data.clipboard.history.filter((c) => c.id !== id);
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
    data.clipboard.history = data.clipboard.history.filter((c) => c.pinned);
    commit();
  });
  H("copy", (_, t) => {
    writeClip(str(t, 200000));
    return true;
  });
  H(
    "paste",
    (e, t) =>
      new Promise((res) => {
        t = str(t, 200000);
        const prev = clipboard.readText();
        writeClip(t);
        const w = BrowserWindow.fromWebContents(e.sender);
        if (w === mainWin)
          return res({
            ok: false,
            msg: "Copied. Direct paste works from the picker/launcher popups.",
          });
        if (w && !w.isDestroyed()) w.close();
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
          250,
        );
      }),
  );
  H("settings:set", (_, p) => {
    if (p && typeof p === "object") {
      applySettings(p);
      commit();
    }
  });
  H("settings:reset", () => {
    backupNow("prereset");
    data.settings = DEF().settings;
    data.globalShortcuts = { ...DEF_SHORTCUTS };
    nativeTheme.themeSource = "light";
    regShortcuts();
    toggleLauncher(false);
    toggleWidget(false);
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
      seen = {};
    const conflicts = {};
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
    if (name === "main") {
      if (mainWin) mainWin.__userOpen = true;
      showMain(typeof arg === "object" && arg ? arg.page : arg, arg && arg.id);
      if (mainWin) mainWin.__userOpen = true;
    } else if (
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
    data = merge(DEF(), j);
    data.schemaVersion = SCHEMA;
    regShortcuts();
    startClip();
    buildTray();
    toggleLauncher(data.settings.launcherEnabled);
    toggleWidget(data.settings.widgetEnabled);
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
  H("data:backup", () => {
    const f = backupNow("manual");
    return f || "";
  });
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
    else if (k === "clipboard") data.clipboard.history = [];
    else if (k === "bookmarks") data.bookmarks = [];
    else if (k === "log") {
      logs = [];
      fs.writeFileSync(LOG, "[]");
    } else if (k === "peaks") data.systemStats.peaks = { cpu: 0, ram: 0 };
    commit();
  });
  H("term:run", (_, l) => term(l));
}

/* ---------- lifecycle ---------- */
if (!app.requestSingleInstanceLock()) app.quit();
app.on("second-instance", () => showMain("dashboard"));
app.on("web-contents-created", (_, c) => {
  c.setWindowOpenHandler(() => ({ action: "deny" }));
  c.on("will-navigate", (e) => e.preventDefault());
});
app.whenReady().then(() => {
  DIR = app.getPath("userData");
  FILE = path.join(DIR, "data.json");
  LOG = path.join(DIR, "system_log.json");
  fs.mkdirSync(backupsDir(), { recursive: true });
  try {
    logs = JSON.parse(fs.readFileSync(LOG, "utf8"));
  } catch {
    logs = [];
  }
  data = load();
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
  startSys();
  showMain();
  if (data.settings.startMinimized && mainWin)
    mainWin.once("ready-to-show", () => mainWin.hide());
  if (data.settings.launcherEnabled) toggleLauncher(true);
  if (data.settings.widgetEnabled) toggleWidget(true);
  setInterval(() => {
    pruneClip();
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
  saveNow();
  try {
    fs.writeFileSync(LOG, JSON.stringify(logs));
  } catch {
    /* ignore */
  }
});
