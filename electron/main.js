const { app, BrowserWindow, ipcMain, dialog, shell, protocol } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile, fork } = require('child_process');

const { detectSources } = require('./src/detectors');
const sqliteParser = require('./src/sqlite-parser');

let mainWindow = null;

// Register a privileged custom scheme so the Next.js static export (which uses
// absolute paths like /_next/... and /webgl/...) resolves correctly inside the
// packaged app. With loadFile() + file:// those become file:///_next/... (fs root)
// and every asset 404s, leaving a broken/blank page. app:// maps onto dist/.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, bypassCSP: true, stream: true } },
]);

// ============================================================================
// Content directory resolution
// The "content directory" is the 记忆罐头 project folder that contains
// web/dist/index.html, projects/, data/, etc.
// In dev mode, it's the parent of electron/. In packaged mode:
//   1. read the path from userData config.json (set on first run / by user)
//   2. else try common default locations
//   3. else seed a self-contained directory from the bundled resources into
//      ~/Documents/记忆罐头 (copies the frontend, creates empty projects/data)
//      so a fresh install works without manual folder selection.
// ============================================================================
let CONTENT_DIR = '';

function getConfigPath() {
  const dir = app.getPath('userData');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'config.json');
}

function readConfig() {
  const cfgPath = getConfigPath();
  try {
    if (fs.existsSync(cfgPath)) {
      return JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
    }
  } catch {}
  return {};
}

function saveConfig(cfg) {
  const cfgPath = getConfigPath();
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf-8');
}

// 跨设备迁移：从 app 资源目录向上查找"记忆罐头"项目根（含 projects/
// 且与 web/ 或 electron/ 同级的目录）。把整个项目文件夹移到任意路径后，
// app 仍能自动定位 projects/ 数据，不会丢。
function findProjectRootFromApp(maxDepth = 8) {
  let cur = process.resourcesPath;
  for (let i = 0; i < maxDepth; i++) {
    const hasProjects = fs.existsSync(path.join(cur, "projects"));
    const hasSrc = fs.existsSync(path.join(cur, "web")) || fs.existsSync(path.join(cur, "electron"));
    if (hasProjects && hasSrc) return cur;
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return null;
}

async function resolveContentDir() {
  if (!app.isPackaged) {
    // Dev mode: content is parent of electron/
    CONTENT_DIR = path.resolve(__dirname, '..');
    return;
  }

  // Packaged mode: read from config
  const cfg = readConfig();
  if (cfg.contentPath && isValidContentDir(cfg.contentPath)) {
    CONTENT_DIR = cfg.contentPath;
    return;
  }

  // Try common default locations (look for the 3D gallery static export)
  const defaults = [
    path.join(app.getPath('home'), 'AI/flash/记忆罐头'),
    path.join(app.getPath('home'), '记忆罐头'),
    path.join(app.getPath('documents'), '记忆罐头'),
  ];
  for (const d of defaults) {
    if (isValidContentDir(d)) {
      CONTENT_DIR = d;
      saveConfig({ contentPath: d });
      return;
    }
  }

  // 跨设备 / 移动整个项目文件夹：从 app 位置向上查找项目根，
  // 保证移动后仍能找到 projects/ 数据，而不是盲目 seed 出空库。
  const appRoot = findProjectRootFromApp();
  if (appRoot && isValidContentDir(appRoot)) {
    CONTENT_DIR = appRoot;
    saveConfig({ contentPath: appRoot });
    return;
  }

  // First run on a fresh machine: seed a self-contained content directory
  // from the bundled resources so the app works without manual selection.
  const seedTarget = path.join(app.getPath('documents'), '记忆罐头');
  await seedContentDir(seedTarget);
  CONTENT_DIR = seedTarget;
  saveConfig({ contentPath: seedTarget });
}

// A valid content dir must contain the built gallery (web/dist/index.html)
function isValidContentDir(d) {
  try {
    return !!d && fs.existsSync(d) && fs.existsSync(path.join(d, 'web', 'dist', 'index.html'));
  } catch {
    return false;
  }
}

// Copy the bundled frontend + create empty projects/data into the target so a
// fresh install is fully usable out of the box (no manual folder selection).
async function seedContentDir(target) {
  fs.mkdirSync(target, { recursive: true });
  const srcDist = path.join(process.resourcesPath, 'web', 'dist');
  if (fs.existsSync(srcDist)) {
    fs.cpSync(srcDist, path.join(target, 'web', 'dist'), { recursive: true });
  }
  fs.mkdirSync(path.join(target, 'projects'), { recursive: true });
  fs.mkdirSync(path.join(target, 'data'), { recursive: true });
  const srcPy = path.join(process.resourcesPath, 'anonymize_chat_logs.py');
  if (fs.existsSync(srcPy)) {
    fs.copyFileSync(srcPy, path.join(target, 'anonymize_chat_logs.py'));
  }
  // Seed the data-collection prompt so a fresh user has the instructions on
  // disk (and getCollectionPrompt finds it at CONTENT_DIR root without falling
  // back to the hardcoded FALLBACK_PROMPT).
  const srcPrompt = path.join(process.resourcesPath, '给智能体的数据收集指令.md');
  if (fs.existsSync(srcPrompt)) {
    fs.copyFileSync(srcPrompt, path.join(target, '给智能体的数据收集指令.md'));
  }
}

// Path getters (use CONTENT_DIR)
function getProjectsDir() { return path.join(CONTENT_DIR, 'projects'); }
function getDataDir() { return path.join(CONTENT_DIR, 'data'); }
function getDataJson() { return path.join(getDataDir(), 'projects.json'); }

// The electron src/ directory (where detectors.js and sqlite-parser.js live)
function getElectronSrcDir() {
  // In packaged mode, src/ is inside the app bundle
  // In dev mode, it's relative to __dirname
  return path.join(__dirname, 'src');
}

// Serve the Next.js static export from app:// so absolute asset paths resolve.
// In packaged mode we serve straight from the bundled copy inside the app
// (Resources/web/dist) rather than the user's CONTENT_DIR. The frontend is a
// read-only static export, so there is no reason to keep a stale user copy that
// never gets updated on reinstall — serving from the bundle guarantees the
// running UI always matches the installed DMG build.
function registerAppProtocol() {
  const DIST_DIR = app.isPackaged
    ? path.join(process.resourcesPath, 'web', 'dist')
    : path.join(CONTENT_DIR, 'web', 'dist');
  if (!fs.existsSync(DIST_DIR)) {
    console.error('[app] dist not found:', DIST_DIR);
    return;
  }
  protocol.registerFileProtocol('app', (request, callback) => {
    try {
      const parsed = new URL(request.url);
      let pathname = decodeURIComponent(parsed.pathname);
      if (pathname === '/' || pathname === '') pathname = '/index.html';
      let filePath = path.normalize(path.join(DIST_DIR, pathname));
      if (!filePath.startsWith(DIST_DIR)) {
        callback({ error: -2 }); // FILE_NOT_FOUND
        return;
      }
      // Next.js static export uses directory-based routes (e.g. /detail/
      // maps to /detail/index.html). Without this, requesting /detail/
      // serves a directory which fails silently and the browser falls back
      // to the root index.html — making every detail link open the home page.
      if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
        const indexFile = path.join(filePath, 'index.html');
        if (fs.existsSync(indexFile)) {
          callback({ path: indexFile });
          return;
        }
      }
      callback({ path: filePath });
    } catch (e) {
      callback({ error: -2 });
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 650,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#08070a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      // Keep contextIsolation ON. Turning it off previously broke the app://
      // preload bridge (window.api became undefined, so IPC-driven features
      // like "打开文件夹" silently failed). Isolation is required here because
      // the frontend runs on a custom app:// scheme.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // Load the 3D capsule gallery (Next.js static export) through the app://
  // scheme so absolute paths (/_next, /webgl, /fonts) resolve inside dist/.
  const galleryIndex = path.join(CONTENT_DIR, 'web', 'dist', 'index.html');
  if (fs.existsSync(galleryIndex)) {
    mainWindow.loadURL('app://app/index.html');
  } else {
    // fallback to the static export if the app:// scheme is unavailable
    mainWindow.loadFile(galleryIndex);
  }

  // Capture files/folders dropped onto the window. Electron's default for an
  // OS file/folder drag (when the renderer doesn't handle it) is to navigate
  // the webContents to a file:// URL. We intercept that URL to recover the real
  // filesystem path — the renderer cannot read it directly because context
  // isolation / origin security strips File.path and text/uri-list — then
  // prevent the navigation and forward the resolved folder to the front-end.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!/^file:\/\//i.test(url)) return;
    event.preventDefault();
    try {
      let p = decodeURIComponent(url.replace(/^file:\/\//, ''));
      p = p.replace(/^\/localhost/, '');
      if (!fs.existsSync(p)) return;
      const folderPath = fs.statSync(p).isDirectory() ? p : path.dirname(p);
      mainWindow.webContents.send('native-drop', { folderPath });
    } catch {
      /* ignore unreadable drops */
    }
  });

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => { mainWindow = null; });
}

function watchProjectsDir() {
  const projectsDir = getProjectsDir();
  if (!fs.existsSync(projectsDir)) {
    fs.mkdirSync(projectsDir, { recursive: true });
  }
  let debounceTimer = null;
  const onChange = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('projects-changed');
      }
    }, 500);
  };
  // Recursive watcher catches file/content changes inside project folders.
  fs.watch(projectsDir, { recursive: true }, onChange);
  // Top-level (non-recursive) watcher reliably catches folder add / remove / RENAME
  // on macOS, where recursive watch often misses directory renames.
  fs.watch(projectsDir, onChange);
}

app.whenReady().then(async () => {
  await resolveContentDir();
  registerAppProtocol();
  createWindow();
  watchProjectsDir();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ============================================================================
// Path helpers
// ============================================================================
function getAnonymizerPath() {
  const contentPath = path.join(CONTENT_DIR, 'anonymize_chat_logs.py');
  if (fs.existsSync(contentPath)) return contentPath;
  const devPath = path.join(__dirname, '..', 'anonymize_chat_logs.py');
  if (fs.existsSync(devPath)) return devPath;
  return path.join(process.resourcesPath, 'anonymize_chat_logs.py');
}

// ============================================================================
// Data collection (collect.js integration)
// ============================================================================

function runCollect(args) {
  return new Promise((resolve) => {
    const collectScript = path.join(CONTENT_DIR, 'collect.js');
    const proc = fork(collectScript, args, {
      cwd: CONTENT_DIR,
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      env: {
        ...process.env,
        // Pass the electron src/ path so collect.js can find detectors.js and sqlite-parser.js
        CAPSULE_ELECTRON_SRC: getElectronSrcDir(),
        CAPSULE_NODE_MODULES: path.join(__dirname, 'node_modules'),
      },
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.stderr.on('data', (data) => { stderr += data.toString(); });

    proc.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });

    proc.on('error', (err) => {
      resolve({ code: 1, stdout, stderr: err.message });
    });
  });
}

// Color palette for capsules — 8 distinct hues, used in a fixed cycle so that
// neighbouring projects (by sorted date) never share a color.
const CAPSULE_COLORS = [
  { name: 'amber',   primary: '#d4a574', secondary: '#c97b4f', glow: 'rgba(212,165,116,0.15)' },
  { name: 'coral',   primary: '#e07a5f', secondary: '#c4584a', glow: 'rgba(224,122,95,0.15)' },
  { name: 'rose',    primary: '#d4748f', secondary: '#b85a7a', glow: 'rgba(212,116,143,0.15)' },
  { name: 'purple',  primary: '#a371f7', secondary: '#8b5ce0', glow: 'rgba(163,113,247,0.15)' },
  { name: 'ocean',   primary: '#6b8caf', secondary: '#4a6f8a', glow: 'rgba(107,140,175,0.15)' },
  { name: 'teal',    primary: '#5fb8a8', secondary: '#3d9b8a', glow: 'rgba(95,184,168,0.15)' },
  { name: 'forest',  primary: '#7ba87b', secondary: '#5d8a5d', glow: 'rgba(123,168,123,0.15)' },
  { name: 'gold',    primary: '#e0b14a', secondary: '#caa033', glow: 'rgba(224,177,74,0.15)' },
];

function getColorForName(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash) + name.charCodeAt(i);
    hash |= 0;
  }
  return CAPSULE_COLORS[Math.abs(hash) % CAPSULE_COLORS.length];
}

function getTimestamp(ts) {
  if (!ts) return 0;
  try {
    const d = typeof ts === 'number' ? new Date(ts > 1e12 ? ts : ts * 1000) : new Date(ts);
    return isNaN(d) ? 0 : d.getTime();
  } catch { return 0; }
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// Live scan of projects/ folder — reflects deletions and additions immediately
function readProjectsData() {
  const projectsDir = getProjectsDir();
  const projects = [];

  if (!fs.existsSync(projectsDir)) {
    fs.mkdirSync(projectsDir, { recursive: true });
  } else {
    const entries = fs.readdirSync(projectsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const projDir = path.join(projectsDir, entry.name);
      const jsonPath = path.join(projDir, 'project.json');
      if (!fs.existsSync(jsonPath)) continue;
      try {
        const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
        if (!data.id) data.id = uid();
        // Display name + folder both follow the real folder name, so renaming a
        // folder renames it in the list and keeps "打开文件夹" pointing at the right place.
        // Color is read from project.json (fixed at import time). Only fall back
        // to position-based cycling for legacy projects that have no stored color.
        projects.push({ ...data, id: data.id, folder: entry.name, name: entry.name });
      } catch (e) {
        console.error(`[main] Parse error: ${entry.name}/project.json - ${e.message}`);
      }
    }
  }

  // Sort by most recent first
  projects.sort((a, b) => {
    const ta = getTimestamp(a.timeRange?.start || a.createdAt || a.updatedAt);
    const tb = getTimestamp(b.timeRange?.start || b.createdAt || b.updatedAt);
    return tb - ta;
  });

  // Assign colors: prefer the color stored in project.json (fixed at import
  // time). For legacy projects without a stored color, cycle the palette by
  // sorted position so adjacent projects still get different hues.
  projects.forEach((p, i) => {
    if (!p.color || !p.color.primary) {
      p.color = CAPSULE_COLORS[i % CAPSULE_COLORS.length];
    }
  });

  // Aggregate stats
  let totalConversations = 0;
  let totalMessages = 0;
  for (const p of projects) {
    totalConversations += p.stats?.conversationCount || p.conversations?.length || 0;
    totalMessages += p.stats?.messageCount || 0;
  }

  const result = {
    version: 2,
    generatedAt: new Date().toISOString(),
    capsuleName: '记忆罐头',
    totalProjects: projects.length,
    totalConversations,
    totalMessages,
    projects,
  };

  // Keep the cached projects.json in sync (for web page fallback)
  try {
    const dataDir = getDataDir();
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(getDataJson(), JSON.stringify(result, null, 2), 'utf-8');
  } catch (e) {
    console.error('[main] Failed to sync projects.json:', e.message);
  }

  return result;
}

function readProjectDetail(folderName) {
  const projDir = path.join(getProjectsDir(), folderName);
  const jsonPath = path.join(projDir, 'project.json');
  if (!fs.existsSync(jsonPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  } catch (e) {
    return null;
  }
}

// Resolve a project's folder name from either the folder name itself or the
// project id (uid) stored inside project.json. The detail page navigates by
// capsule.id (the uid), while project.json lives under the folder name, so we
// need id → folder resolution for runtime lookups.
function findProjectFolderById(id) {
  const projectsDir = getProjectsDir();
  if (!fs.existsSync(projectsDir)) return null;
  if (!id) return null;
  for (const entry of fs.readdirSync(projectsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const jsonPath = path.join(projectsDir, entry.name, 'project.json');
    if (!fs.existsSync(jsonPath)) continue;
    try {
      const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
      if (data.id === id) return entry.name;
    } catch (e) {
      /* ignore malformed json */
    }
  }
  return null;
}

// ============================================================================
// IPC: Data Collection
// ============================================================================

ipcMain.handle('collect-scan', async () => {
  try {
    const result = await runCollect(['--scan']);
    return { success: result.code === 0, stdout: result.stdout, stderr: result.stderr };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('collect-refresh', async () => {
  try {
    const result = await runCollect([]);
    return { success: result.code === 0, stdout: result.stdout, stderr: result.stderr };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('get-projects-data', async () => {
  try {
    const data = readProjectsData();
    return { success: true, data };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('get-project-detail', async (event, key) => {
  try {
    // key may be a folder name or a project id (uid) — resolve to folder first.
    let folderName = key;
    if (!fs.existsSync(path.join(getProjectsDir(), key))) {
      folderName = findProjectFolderById(key);
    }
    if (!folderName) return { success: false, error: '项目不存在' };
    const data = readProjectDetail(folderName);
    if (!data) return { success: false, error: '项目不存在' };
    // Keep the display name in sync with the REAL folder name. The home list
    // already derives its name from the folder, so renaming a folder renames it
    // there — the detail page must do the same, otherwise the title stays stale.
    data.name = folderName;
    // Use the SAME position-based color as the home carousel. The home assigns
    // colors by sorted position; the detail page previously fell back to the
    // import-time name-hash color, which could differ and made a can look
    // "orange outside, blue inside". Deriving it here from the same sorted list
    // guarantees the can hue matches the detail theme.
    try {
      const all = readProjectsData();
      const match = (all.projects || []).find((p) => p.folder === folderName);
      if (match && match.color) data.color = match.color;
    } catch (e) {
      // on any failure, keep the color already stored in project.json
    }
    return { success: true, data, folder: folderName };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// Associate a local output folder with a project so the detail page "打开文件夹"
// can open it directly. If no path was captured at import time, the user picks
// one here and it is persisted into project.json.
ipcMain.handle('associate-project-folder', async (event, key, projectPath) => {
  try {
    if (!key) return { success: false, error: '缺少项目标识' };
    let folderName = key;
    if (!fs.existsSync(path.join(getProjectsDir(), key))) {
      folderName = findProjectFolderById(key);
    }
    if (!folderName) return { success: false, error: '项目不存在' };
    const projDir = path.join(getProjectsDir(), folderName);
    const jsonPath = path.join(projDir, 'project.json');
    if (!fs.existsSync(jsonPath)) return { success: false, error: '项目文件不存在' };
    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    data.projectPath = projectPath || '';
    fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2), 'utf-8');
    // let the home page refresh its live data
    try {
      if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send('projects-changed');
      }
    } catch (e) {
      /* ignore */
    }
    return { success: true, folder: folderName };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('update-project-summary', async (event, key, summaryText) => {
  try {
    if (!key) return { success: false, error: '缺少项目标识' };
    let folderName = key;
    if (!fs.existsSync(path.join(getProjectsDir(), key))) {
      folderName = findProjectFolderById(key);
    }
    if (!folderName) return { success: false, error: '项目不存在' };
    const projDir = path.join(getProjectsDir(), folderName);
    const jsonPath = path.join(projDir, 'project.json');
    if (!fs.existsSync(jsonPath)) return { success: false, error: '项目文件不存在' };
    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    data.summary = typeof summaryText === 'string' ? summaryText.trim() : '';
    fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2), 'utf-8');
    // Summary edits are pushed optimistically by the detail page; do NOT
    // broadcast projects-changed here, because that would reload the whole
    // detail view and cause a visible flash.
    return { success: true, folder: folderName };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('open-projects-folder', async () => {
  const projectsDir = getProjectsDir();
  if (!fs.existsSync(projectsDir)) {
    fs.mkdirSync(projectsDir, { recursive: true });
  }
  shell.openPath(projectsDir);
  return { success: true };
});

ipcMain.handle('project-folder-exists', async (event, pathOrName) => {
  if (!pathOrName) return { exists: false };
  // accept an absolute output path, or a folder name under projects/
  const target = path.isAbsolute(pathOrName)
    ? pathOrName
    : path.join(getProjectsDir(), pathOrName);
  return { exists: fs.existsSync(target) };
});

ipcMain.handle('open-project-folder', async (event, pathOrName) => {
  if (!pathOrName) return { success: false, error: '缺少路径' };
  // accept an absolute output path, or a folder name under projects/
  const target = path.isAbsolute(pathOrName)
    ? pathOrName
    : path.join(getProjectsDir(), pathOrName);
  if (!fs.existsSync(target)) return { success: false, error: '本地文件夹不存在' };
  shell.openPath(target);
  return { success: true };
});

ipcMain.handle('collect-import-file', async (event, filePath) => {
  try {
    const result = await runCollect(['--file', filePath]);
    return { success: result.code === 0, stdout: result.stdout, stderr: result.stderr };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('collect-import-folder', async (event, folderPath) => {
  try {
    const result = await runCollect(['--folder', folderPath]);
    return { success: result.code === 0, stdout: result.stdout, stderr: result.stderr };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// Delete a project folder
ipcMain.handle('delete-project', async (event, folderName) => {
  try {
    if (!folderName) return { success: false, error: '缺少项目文件夹名称' };
    const safeName = path.basename(folderName);
    const projDir = path.join(getProjectsDir(), safeName);
    if (!fs.existsSync(projDir)) {
      return { success: false, error: '项目文件夹不存在' };
    }
    const choice = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      buttons: ['删除', '取消'],
      defaultId: 1,
      title: '删除项目',
      message: `确定删除项目「${safeName}」吗？`,
      detail: '该操作将删除项目文件夹及其所有对话记录，且不可恢复。',
    });
    if (choice.response === 1) {
      return { success: false, canceled: true };
    }
    fs.rmSync(projDir, { recursive: true, force: true });
    return { success: true, folderName: safeName };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ============================================================================
// IPC: AI Agent Detection
// ============================================================================

ipcMain.handle('detect-sources', async () => {
  try {
    return { success: true, sources: detectSources() };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('import-from-source', async (event, sourceId) => {
  try {
    const sources = detectSources();
    const source = sources.find(s => s.id === sourceId);
    if (!source) return { success: false, error: `Unknown source: ${sourceId}` };
    if (!source.exists) return { success: false, error: `${source.name} 未安装或未找到数据目录` };

    if (source.type === 'app-workbuddy') {
      return { success: false, error: 'CodeBuddy 的对话记录保存在云端，不支持直接扫描。请用「导入文件夹」：在 CodeBuddy 中运行数据收集指令，把记录导出到本地文件夹后再导入。' };
    }
    if (source.type === 'app-cindy') {
      return { success: false, error: 'Cindy 的对话记录暂不支持直接扫描。请用「导入文件夹」：在 Cindy 中导出记录到本地文件夹后再导入。' };
    }
    if (source.type === 'app-codex-desktop') {
      return { success: false, error: 'Codex 桌面版的对话记录暂不支持直接扫描。请用「导入文件夹」：在 Codex 中导出记录到本地文件夹后再导入。' };
    }

    if (source.type.startsWith('sqlite-')) {
      await sqliteParser.getSQL();
    }

    let conversations = [];
    switch (source.type) {
      case 'sqlite-cursor':
        conversations = await sqliteParser.parseCursor(source.path);
        break;
      case 'sqlite-trae':
        conversations = await sqliteParser.parseTrae(source.path);
        break;
      case 'sqlite-vscode':
        conversations = sqliteParser.parseVSCode(source.path);
        break;
      case 'jsonl-claude':
        conversations = sqliteParser.parseClaudeCode(source.path);
        break;
      case 'jsonl-codex':
        conversations = sqliteParser.parseCodex(source.path);
        break;
      default:
        return { success: false, error: `Unknown source type: ${source.type}` };
    }

    conversations.sort((a, b) =>
      (b.createdAt || '').localeCompare(a.createdAt || ''));

    return { success: true, conversations, sourceName: source.name };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ============================================================================
// IPC: Import to Project (Wizard)
// ============================================================================

function sanitizeFolderName(name) {
  return name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/^\.+/, '')
    .slice(0, 60) || 'unnamed_project';
}

function formatDateTime(ts) {
  if (!ts) return '';
  try {
    const d = typeof ts === 'number' ? new Date(ts > 1e12 ? ts : ts * 1000) : new Date(ts);
    if (isNaN(d)) return '';
    // Use LOCAL time, not UTC — the user's wall-clock day matters for the
    // project date range and heatmap, not the server's timezone.
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`;
  } catch { return ''; }
}

function formatDate(ts) {
  if (!ts) return '';
  try {
    const d = new Date(ts);
    if (isNaN(d)) return '';
    // LOCAL date (not UTC) so the heatmap buckets messages into the user's
    // actual calendar day instead of shifting early-morning activity back a day.
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  } catch { return ''; }
}

function estimateTokens(text) { return text ? Math.ceil(text.length / 4) : 0; }

// 对话次数 = 一轮「用户提问 + AI 回答」。扫描消息序列，每遇到一个用户提问
// （且上一条不是用户提问，连续追问合并为一轮）计为一轮；AI 回复后本轮结束。
function countDialogTurns(messages) {
  // 去掉连续追问合并逻辑：每一条用户消息算一次对话
  return (messages || []).filter(m => (m.role || '').toLowerCase() === 'user').length;
}

// Map raw source id/name to a stable agent identity for icons / display.
// Falls back to the conversation's `source` field when a generic id such as
// 'imported' or 'unknown' was assigned during folder/file import.
function resolveAgentIdentity(conv) {
  const source = (conv.source || '').toString().toLowerCase();
  const rawId = (conv.agentId || '').toString().toLowerCase();
  const rawName = (conv.agentName || '').toString();
  const genericIds = new Set(['imported', 'unknown', 'generic', '']);

  let id = rawId;
  let name = rawName || source;

  if (genericIds.has(id)) {
    id = source || 'imported';
  }

  const displayNames = {
    trae: 'Trae', cursor: 'Cursor', claude: 'Claude Code', codex: 'Codex',
    gemini: 'Gemini', openai: 'OpenAI', cindy: 'Cindy',
    workbuddy: 'CodeBuddy', codebuddy: 'CodeBuddy',
    windsurf: 'Windsurf', vscode: 'VS Code', 'vscode-copilot': 'VS Code Copilot',
    qoder: 'Qoder',
  };

  if (!name || genericIds.has(name.toLowerCase())) {
    name = displayNames[id] || (id ? id[0].toUpperCase() + id.slice(1) : '导入文件');
  }

  return { id, name, icon: conv.agentIcon || '📄' };
}

function createProjectFromConversations(projectName, conversations) {
  let startTime = Infinity, endTime = 0;
  let allMessages = [];
  const agents = new Set();
  const models = new Set();
  let totalTokens = 0, totalChars = 0;
  const heatmapData = {};

  for (const conv of conversations) {
    const ct = getTimestamp(conv.createdAt) || getTimestamp(conv.updatedAt);
    const ut = getTimestamp(conv.updatedAt) || getTimestamp(conv.createdAt);
    if (ct && ct < startTime) startTime = ct;
    if (ut && ut > endTime) endTime = ut;
    if (conv.agentName) agents.add(conv.agentName);

    for (const msg of (conv.messages || [])) {
      allMessages.push({
        conversationId: conv.id, conversationTitle: conv.title,
        role: msg.role, content: msg.content, thinking: msg.thinking || '',
        timestamp: msg.timestamp || '', model: msg.model || '',
        agentName: conv.agentName || '', agentId: conv.agentId || '',
      });
      if (msg.model) models.add(msg.model);
      totalTokens += estimateTokens(msg.content);
      totalChars += (msg.content?.length || 0);
      const dayKey = formatDate(msg.timestamp) || formatDate(conv.createdAt);
      if (dayKey) heatmapData[dayKey] = (heatmapData[dayKey] || 0) + 1;
    }
  }

  if (startTime === Infinity) startTime = 0;
  if (endTime === 0) endTime = startTime;

  // Actual conversation time = the real sum of message-to-message spans across
  // every conversation. Idle gaps longer than GAP_CAP are treated as session
  // breaks (not "time spent in the conversation") and are not counted — so a
  // chat resumed after a day doesn't inflate the total. This replaces the old
  // calendar-span × 4 estimate with honest "实际对话时间的总和".
  const GAP_CAP_MS = 2 * 3600 * 1000;
  let totalActiveMs = 0;
  for (const conv of conversations) {
    const times = (conv.messages || [])
      .map((m) => getTimestamp(m.timestamp || m.time))
      .filter((t) => t > 0)
      .sort((a, b) => a - b);
    for (let i = 1; i < times.length; i++) {
      const gap = times[i] - times[i - 1];
      if (gap <= GAP_CAP_MS) totalActiveMs += gap;
    }
  }
  const durationHours = totalActiveMs > 0 ? totalActiveMs / 3600000 : 0;

  const agentList = [];
  const seenAgents = new Set();
  for (const conv of conversations) {
    const agent = resolveAgentIdentity(conv);
    if (!seenAgents.has(agent.id)) {
      seenAgents.add(agent.id);
      agentList.push({
        id: agent.id,
        name: agent.name,
        icon: agent.icon,
        conversationCount: conversations.filter(c => resolveAgentIdentity(c).id === agent.id).length,
      });
    }
  }

  // Generate a REAL project-level summary from the actual conversations — not a
  // truncated clip of one message. We filter out the collection prompt itself
  // (the user may have pasted the "data collection instructions" into the chat),
  // then take each conversation's real user intent, dedupe them, and compose a
  // short paragraph describing what the whole project covered.
  // 事实型项目总结（纯本地，不调用 AI）：描述来源、规模与主题方向，
  // 避免直接复述某一条用户提问。主题取自各对话标题，截断为短标签。
  const SOURCE_DISPLAY = {
    workbuddy: 'CodeBuddy', codebuddy: 'CodeBuddy', cursor: 'Cursor', trae: 'Trae',
    claude: 'Claude Code', codex: 'Codex', gemini: 'Gemini',
    qoder: 'Qoder', generic: '智能体',
  };
  const sourceNames = Array.from(new Set(conversations.map((c) => c.source).filter(Boolean)));
  const sourceLabel = sourceNames.length
    ? sourceNames.map((s) => SOURCE_DISPLAY[s] || s).join('、')
    : '多个智能体';
  const turnCount = conversations.reduce((s, c) => s + countDialogTurns(c.messages), 0);
  const modelCount = Array.from(models).filter(Boolean).length;
  const topicLabels = [];
  const topicSeen = new Set();
  for (const conv of conversations) {
    const t = (conv.title || '').trim();
    if (!t) continue;
    const short = t.length > 18 ? t.slice(0, 18) : t;
    const key = short.replace(/\s/g, '');
    if (topicSeen.has(key)) continue;
    topicSeen.add(key);
    topicLabels.push(short);
    if (topicLabels.length >= 3) break;
  }
  let summary;
  if (topicLabels.length === 0) {
    summary = '从' + sourceLabel + '导入的 ' + conversations.length + ' 段 AI 对话，共 ' + turnCount + ' 轮问答。';
  } else {
    const topics = topicLabels.map((t) => '「' + t + '」').join('、');
    summary = '从' + sourceLabel + '导入的 ' + conversations.length + ' 段 AI 对话，共 ' + turnCount + ' 轮问答、' + modelCount + ' 个模型参与，主题涉及' + topics + '等。';
  }
  if (summary.length > 240) summary = summary.slice(0, 240).replace(/[\s、，；：]+$/g, '') + '…';

  return {
    id: uid(), name: projectName, projectPath: '',
    summary,
    anonymized: false,
    timeRange: {
      start: startTime ? formatDateTime(startTime) : '',
      end: endTime ? formatDateTime(endTime) : '',
      duration: endTime > startTime ? Math.ceil((endTime - startTime) / 86400000) : 0,
    },
    stats: {
      conversationCount: conversations.reduce((s, c) => s + countDialogTurns(c.messages), 0), messageCount: allMessages.length,
      userMessageCount: allMessages.filter(m => m.role === 'user').length,
      assistantMessageCount: allMessages.filter(m => m.role === 'assistant').length,
      totalTokens, totalChars,
      durationHours,
    },
    agents: agentList, models: Array.from(models).filter(Boolean),
    heatmap: heatmapData,
    conversations: conversations.map(c => ({
      id: c.id, title: c.title, source: c.source,
      agentName: c.agentName || '', agentId: c.agentId || '', agentIcon: c.agentIcon || '',
      projectPath: c.projectPath || '', sourceFile: c.sourceFile || '',
      createdAt: c.createdAt || '', updatedAt: c.updatedAt || '',
      messageCount: c.messages?.length || 0, messages: c.messages || [],
    })),
  };
}

function projectAlreadyExists(projectsDir, folderName) {
  const dir = path.join(projectsDir, folderName);
  return fs.existsSync(dir) && fs.existsSync(path.join(dir, 'project.json'));
}

// Scan selected agent sources and return all conversations tagged with their
// source info. Shared by preview-scan and import-to-project so they stay in
// sync on what gets scanned.
async function scanAgentConversations(sourceIds) {
  const sources = detectSources();
  let workbuddyChosen = false;
  let cindyChosen = false;
  let codexDesktopChosen = false;
  let sawScannable = false;
  const allConversations = [];

  for (const sourceId of (sourceIds || [])) {
    const source = sources.find(s => s.id === sourceId);
    if (!source || !source.exists) continue;
    if (source.type === 'app-workbuddy') { workbuddyChosen = true; continue; }
    if (source.type === 'app-cindy') { cindyChosen = true; continue; }
    if (source.type === 'app-codex-desktop') { codexDesktopChosen = true; continue; }
    sawScannable = true;

    if (source.type.startsWith('sqlite-')) {
      await sqliteParser.getSQL();
    }

    let conversations = [];
    switch (source.type) {
      case 'sqlite-cursor': conversations = await sqliteParser.parseCursor(source.path); break;
      case 'sqlite-trae': conversations = await sqliteParser.parseTrae(source.path); break;
      case 'sqlite-vscode': conversations = sqliteParser.parseVSCode(source.path); break;
      case 'jsonl-claude': conversations = sqliteParser.parseClaudeCode(source.path); break;
      case 'jsonl-codex': conversations = sqliteParser.parseCodex(source.path); break;
    }

    for (const conv of conversations) {
      conv.agentName = source.name;
      conv.agentId = source.id;
      conv.agentIcon = source.icon;
    }
    allConversations.push(...conversations);
  }

  return { allConversations, workbuddyChosen, cindyChosen, codexDesktopChosen, sawScannable };
}

// Group conversations into "project folders" the user can pick from.
// Grouping strategy:
//   1. If a conversation has a projectPath (real workspace folder, e.g. from
//      Claude Code's JSONL or Cursor's workspace.json), group by that.
//   2. Otherwise, group by the date (YYYY-MM-DD) of the conversation's
//      createdAt — this splits Cursor's global-storage conversations (which
//      have no project path) into per-day batches the user can pick from.
function groupConversationsByProject(conversations) {
  const groups = new Map();

  for (const conv of conversations) {
    const rawPath = conv.projectPath || '';
    let groupKey, label;

    if (rawPath) {
      groupKey = rawPath;
      const parts = rawPath.replace(/\\/g, '/').split('/').filter(Boolean);
      label = parts.length ? parts[parts.length - 1] : rawPath;
    } else {
      // Group by date — fall back to "未知日期" if no createdAt.
      const dateStr = (conv.createdAt || '').slice(0, 10) || '未知日期';
      groupKey = `__date__:${dateStr}`;
      label = dateStr;
    }

    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        key: groupKey,
        label,
        fullPath: rawPath || '',
        agentName: conv.agentName || '',
        conversations: [],
        lastModified: '',
      });
    }
    const g = groups.get(groupKey);
    g.conversations.push(conv);
    if (conv.updatedAt && conv.updatedAt > g.lastModified) {
      g.lastModified = conv.updatedAt;
    }
  }

  return Array.from(groups.values()).sort((a, b) => b.lastModified.localeCompare(a.lastModified));
}

// Preview scan: scan selected sources and return grouped conversations so the
// UI can show them as selectable folders before importing.
ipcMain.handle('preview-scan', async (event, params) => {
  try {
    const { sourceIds } = params;
    const { allConversations, workbuddyChosen, cindyChosen, codexDesktopChosen, sawScannable } = await scanAgentConversations(sourceIds);

    if (allConversations.length === 0) {
      if (workbuddyChosen && !sawScannable) {
        return { success: false, error: 'CodeBuddy 的对话记录保存在云端，不支持直接扫描。请用「导入文件夹」：在 CodeBuddy 中运行数据收集指令，把记录导出到本地文件夹后再导入。' };
      }
      if (cindyChosen && !sawScannable) {
        return { success: false, error: 'Cindy 的对话记录暂不支持直接扫描。请用「导入文件夹」：在 Cindy 中导出记录到本地文件夹后再导入。' };
      }
      if (codexDesktopChosen && !sawScannable) {
        return { success: false, error: 'Codex 桌面版的对话记录暂不支持直接扫描。请用「导入文件夹」：在 Codex 中导出记录到本地文件夹后再导入。' };
      }
      return { success: false, error: '选中的智能体中未找到对话记录' };
    }

    const groups = groupConversationsByProject(allConversations);
    return {
      success: true,
      groups: groups.map(g => ({
        key: g.key,
        label: g.label,
        fullPath: g.fullPath,
        agentName: g.agentName,
        conversationCount: g.conversations.length,
        lastModified: g.lastModified,
      })),
      totalConversations: allConversations.length,
    };
  } catch (e) {
    return { success: false, error: e && e.message ? e.message : String(e) };
  }
});

ipcMain.handle('import-to-project', async (event, params) => {
  try {
    const { sourceType, sourceIds, filePaths, folderPath, projectName, selectedGroups } = params;
    let allConversations = [];

    if (sourceType === 'scan') {
      // Import from selected AI agent sources
      const { allConversations: scanned, workbuddyChosen, cindyChosen, codexDesktopChosen, sawScannable } = await scanAgentConversations(sourceIds);
      allConversations = scanned;

      if (allConversations.length === 0) {
        if (workbuddyChosen && !sawScannable) {
          return { success: false, error: 'CodeBuddy 的对话记录保存在云端，不支持直接扫描。请用「导入文件夹」：在 CodeBuddy 中运行数据收集指令，把记录导出到本地文件夹后再导入。' };
        }
        if (cindyChosen && !sawScannable) {
          return { success: false, error: 'Cindy 的对话记录暂不支持直接扫描。请用「导入文件夹」：在 Cindy 中导出记录到本地文件夹后再导入。' };
        }
        if (codexDesktopChosen && !sawScannable) {
          return { success: false, error: 'Codex 桌面版的对话记录暂不支持直接扫描。请用「导入文件夹」：在 Codex 中导出记录到本地文件夹后再导入。' };
        }
        return { success: false, error: '选中的智能体中未找到对话记录' };
      }

      // If the user selected specific groups in the preview step, filter to
      // just those conversations and create one project per group.
      if (selectedGroups && selectedGroups.length > 0) {
        const groups = groupConversationsByProject(allConversations);
        const selectedSet = new Set(selectedGroups);
        const pickedGroups = groups.filter(g => selectedSet.has(g.key));

        if (pickedGroups.length === 0) {
          return { success: false, error: '未选择任何项目分组' };
        }

        const projectsDir = getProjectsDir();
        if (!fs.existsSync(projectsDir)) fs.mkdirSync(projectsDir, { recursive: true });

        let created = 0;
        let firstFolder = '';
        let totalConvs = 0;
        for (const g of pickedGroups) {
          const pName = g.label;
          const folderName = sanitizeFolderName(pName);
          // Append agent name suffix to avoid collisions when two different
          // agents share the same workspace folder name.
          const finalFolderName = `${folderName}_${g.agentName}`;
          const finalDir = path.join(projectsDir, finalFolderName);

          if (projectAlreadyExists(projectsDir, finalFolderName)) {
            if (params.overwrite) {
              try { fs.rmSync(finalDir, { recursive: true, force: true }); } catch (e) {
                console.error(`[import] Failed to remove existing project: ${e && e.message}`);
              }
            } else {
              // Skip existing projects instead of blocking the whole import.
              // The UI already warned the user per-group before calling.
              continue;
            }
          }

          if (!fs.existsSync(finalDir)) fs.mkdirSync(finalDir, { recursive: true });

          const project = createProjectFromConversations(pName, g.conversations);
          project.color = getColorForName(pName);
          project.folder = finalFolderName;

          fs.writeFileSync(
            path.join(finalDir, 'project.json'),
            JSON.stringify(project, null, 2),
            'utf-8'
          );
          created++;
          totalConvs += g.conversations.length;
          if (!firstFolder) firstFolder = finalFolderName;
        }

        return {
          success: true,
          projectCount: created,
          conversationCount: totalConvs,
          projectFolder: firstFolder,
        };
      }

      // No group selection — fall back to the original single-project behavior.
      // Create project folder
      const folderName = sanitizeFolderName(projectName);
      const projectsDir = getProjectsDir();
      if (!fs.existsSync(projectsDir)) fs.mkdirSync(projectsDir, { recursive: true });

      // If a project with this name already exists: overwrite when explicitly
      // requested, otherwise surface `alreadyExists` so the UI can ask the user.
      if (projectAlreadyExists(projectsDir, folderName)) {
        if (params.overwrite) {
          const existingDir = path.join(projectsDir, folderName);
          try {
            fs.rmSync(existingDir, { recursive: true, force: true });
          } catch (e) {
            console.error(`[import] Failed to remove existing project: ${e && e.message}`);
          }
        } else {
          return { success: true, alreadyExists: true, projectFolder: folderName, projectCount: 0 };
        }
      }
      let finalDir = path.join(projectsDir, folderName);

      if (!fs.existsSync(finalDir)) fs.mkdirSync(finalDir, { recursive: true });

      const project = createProjectFromConversations(projectName, allConversations);
      project.color = getColorForName(projectName);
      project.folder = path.basename(finalDir);

      fs.writeFileSync(
        path.join(finalDir, 'project.json'),
        JSON.stringify(project, null, 2),
        'utf-8'
      );

      return {
        success: true,
        projectCount: 1,
        conversationCount: allConversations.length,
        projectFolder: path.basename(finalDir),
      };

    } else if (sourceType === 'file') {
      // Directly parse files using sqliteParser (no collect.js needed)
      for (const filePath of (filePaths || [])) {
        if (!fs.existsSync(filePath)) continue;
        try {
          const conversations = sqliteParser.parseFile(filePath);
          for (const conv of conversations) {
            const agent = resolveAgentIdentity(conv);
            conv.agentName = agent.name;
            conv.agentId = agent.id;
            conv.agentIcon = agent.icon;
          }
          allConversations.push(...conversations);
        } catch (e) {
          console.error(`[import] Failed to parse ${filePath}: ${e.message}`);
        }
      }

      if (allConversations.length === 0) {
        return { success: false, error: '未能从所选文件中解析出对话记录' };
      }

      // Create project folder with user-specified name
      const folderName = sanitizeFolderName(projectName);
      const projectsDir = getProjectsDir();
      if (!fs.existsSync(projectsDir)) fs.mkdirSync(projectsDir, { recursive: true });

      // If a project with this name already exists: overwrite when explicitly
      // requested, otherwise surface `alreadyExists` so the UI can ask the user.
      if (projectAlreadyExists(projectsDir, folderName)) {
        if (params.overwrite) {
          const existingDir = path.join(projectsDir, folderName);
          try {
            fs.rmSync(existingDir, { recursive: true, force: true });
          } catch (e) {
            console.error(`[import] Failed to remove existing project: ${e && e.message}`);
          }
        } else {
          return { success: true, alreadyExists: true, projectFolder: folderName, projectCount: 0 };
        }
      }
      let finalDir = path.join(projectsDir, folderName);
      if (!fs.existsSync(finalDir)) fs.mkdirSync(finalDir, { recursive: true });

      const project = createProjectFromConversations(projectName, allConversations);
      project.color = getColorForName(projectName);
      project.folder = path.basename(finalDir);

      fs.writeFileSync(
        path.join(finalDir, 'project.json'),
        JSON.stringify(project, null, 2),
        'utf-8'
      );

      return {
        success: true,
        projectCount: 1,
        conversationCount: allConversations.length,
        projectFolder: path.basename(finalDir),
      };

    } else if (sourceType === 'folder' || sourceType === 'prompt') {
      // Scan folder for conversation files and parse directly
      const supportedExts = ['jsonl', 'json', 'md', 'txt', 'log', 'text', 'markdown'];
      const foundFiles = [];

      function scanDir(dir) {
        for (const entry of fs.readdirSync(dir)) {
          const fullPath = path.join(dir, entry);
          const stat = fs.statSync(fullPath);
          if (stat.isDirectory()) {
            scanDir(fullPath);
          } else {
            const ext = path.extname(entry).toLowerCase().slice(1);
            if (supportedExts.includes(ext)) {
              foundFiles.push(fullPath);
            }
          }
        }
      }

      if (!fs.existsSync(folderPath)) {
        return { success: false, error: '文件夹不存在' };
      }
      scanDir(folderPath);

      if (foundFiles.length === 0) {
        return { success: false, error: '文件夹中未找到对话记录文件（支持 JSONL、JSON、MD、TXT、LOG 格式）' };
      }

      for (const filePath of foundFiles) {
        try {
          const conversations = sqliteParser.parseFile(filePath);
          for (const conv of conversations) {
            const agent = resolveAgentIdentity(conv);
            conv.agentName = agent.name;
            conv.agentId = agent.id;
            conv.agentIcon = agent.icon;
          }
          allConversations.push(...conversations);
        } catch (e) {
          console.error(`[import] Failed to parse ${filePath}: ${e.message}`);
        }
      }

      if (allConversations.length === 0) {
        return { success: false, error: '未能从文件夹中解析出对话记录' };
      }

      // Create project folder with user-specified name
      const folderName = sanitizeFolderName(projectName);
      const projectsDir = getProjectsDir();
      if (!fs.existsSync(projectsDir)) fs.mkdirSync(projectsDir, { recursive: true });

      // If a project with this name already exists: overwrite when explicitly
      // requested, otherwise surface `alreadyExists` so the UI can ask the user.
      if (projectAlreadyExists(projectsDir, folderName)) {
        if (params.overwrite) {
          const existingDir = path.join(projectsDir, folderName);
          try {
            fs.rmSync(existingDir, { recursive: true, force: true });
          } catch (e) {
            console.error(`[import] Failed to remove existing project: ${e && e.message}`);
          }
        } else {
          return { success: true, alreadyExists: true, projectFolder: folderName, projectCount: 0 };
        }
      }
      let finalDir = path.join(projectsDir, folderName);
      if (!fs.existsSync(finalDir)) fs.mkdirSync(finalDir, { recursive: true });

      const project = createProjectFromConversations(projectName, allConversations);
      project.color = getColorForName(projectName);
      project.folder = path.basename(finalDir);

      fs.writeFileSync(
        path.join(finalDir, 'project.json'),
        JSON.stringify(project, null, 2),
        'utf-8'
      );

      return {
        success: true,
        projectCount: 1,
        conversationCount: allConversations.length,
        projectFolder: path.basename(finalDir),
      };
    }

    return { success: false, error: '未知的导入类型' };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ============================================================================
// IPC: File Operations
// ============================================================================

ipcMain.handle('select-files', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择对话记录文件',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: '对话记录', extensions: ['jsonl', 'json', 'md', 'txt', 'log', 'text'] },
      { name: '所有文件', extensions: ['*'] },
    ],
  });
  if (result.canceled) return { success: false, canceled: true };
  return { success: true, filePaths: result.filePaths };
});

ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择文件夹',
    properties: ['openDirectory'],
  });
  if (result.canceled) return { success: false, canceled: true };
  return { success: true, folderPath: result.filePaths[0] };
});

// Resolve a folder path from files dropped onto the "import folder" drop zone.
// Electron exposes the real filesystem path on each dropped File object
// (dataTransfer.files[i].path). Depending on the OS a dropped folder may appear
// as a single directory entry or as a flat list of its contents, so we infer
// the intended folder robustly:
//   • exactly one path that is a directory → that directory
//   • exactly one file path → its parent directory
//   • multiple paths → their common ancestor directory
ipcMain.handle('resolve-drop-folder', async (event, paths) => {
  try {
    if (!Array.isArray(paths) || paths.length === 0) {
      return { success: false, error: '未检测到拖入的路径' };
    }
    const existing = paths.filter((p) => typeof p === 'string' && fs.existsSync(p));
    if (existing.length === 0) {
      return { success: false, error: '拖入的路径不存在或无法访问' };
    }
    if (existing.length === 1) {
      let stat;
      try {
        stat = fs.statSync(existing[0]);
      } catch {
        return { success: false, error: '无法读取拖入的路径' };
      }
      const folderPath = stat.isDirectory() ? existing[0] : path.dirname(existing[0]);
      return { success: true, folderPath };
    }
    const dirs = existing.map((p) => {
      let st;
      try {
        st = fs.statSync(p);
      } catch {
        return p;
      }
      return st.isDirectory() ? p : path.dirname(p);
    });
    let common = dirs[0].split(path.sep);
    for (let i = 1; i < dirs.length; i++) {
      const parts = dirs[i].split(path.sep);
      let j = 0;
      while (j < common.length && j < parts.length && common[j] === parts[j]) j++;
      common = common.slice(0, j);
    }
    const folderPath = common.join(path.sep) || path.sep;
    return { success: true, folderPath };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
});

ipcMain.handle('export-file', async (event, filename, content, mime) => {
  try {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '导出文件',
      defaultPath: filename,
      filters: [{ name: '文件', extensions: [filename.split('.').pop() || 'txt'] }],
    });
    if (result.canceled) return { success: false, canceled: true };
    fs.writeFileSync(result.filePath, content, 'utf-8');
    return { success: true, filePath: result.filePath };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('get-collection-prompt', async () => {
  try {
    const candidates = [
      path.join(CONTENT_DIR, '给智能体的数据收集指令.md'),
      path.join(__dirname, '..', '给智能体的数据收集指令.md'),
      path.join(process.resourcesPath, '给智能体的数据收集指令.md'),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        const content = fs.readFileSync(p, 'utf-8');
        return { success: true, content };
      }
    }
    return { success: false, error: '找不到给智能体的数据收集指令.md' };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ============================================================================
// IPC: Anonymizer
// ============================================================================

ipcMain.handle('run-anonymizer', async (event, inputPath, outputPath, termsPath) => {
  return new Promise((resolve) => {
    const scriptPath = getAnonymizerPath();
    if (!fs.existsSync(scriptPath)) {
      resolve({ success: false, error: '找不到脱敏脚本 anonymize_chat_logs.py' });
      return;
    }

    const pythonBin = process.platform === 'win32' ? 'python' : 'python3';
    const args = [scriptPath, inputPath, outputPath];
    if (termsPath) args.push('--terms', termsPath);

    const proc = execFile(pythonBin, args, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        resolve({ success: false, error: stderr || error.message, stdout });
      } else {
        resolve({ success: true, stdout, outputPath });
      }
    });
  });
});

// ============================================================================
// IPC: Anonymize Project (post-import desensitization)
// ============================================================================

ipcMain.handle('select-terms-csv', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择脱敏词表文件',
    properties: ['openFile'],
    filters: [
      { name: 'CSV 词表', extensions: ['csv'] },
      { name: '文本词表', extensions: ['txt', 'tsv'] },
      { name: '所有文件', extensions: ['*'] },
    ],
  });
  if (result.canceled) return { success: false, canceled: true };
  return { success: true, filePath: result.filePaths[0] };
});

ipcMain.handle('anonymize-project', async (event, projectFolder, termsPath) => {
  try {
    if (!projectFolder) return { success: false, error: '缺少项目文件夹名称' };
    const safeName = path.basename(projectFolder);
    const projDir = path.join(getProjectsDir(), safeName);
    const jsonPath = path.join(projDir, 'project.json');
    if (!fs.existsSync(jsonPath)) {
      return { success: false, error: '项目文件不存在' };
    }

    const scriptPath = getAnonymizerPath();
    if (!fs.existsSync(scriptPath)) {
      return { success: false, error: '找不到脱敏脚本 anonymize_chat_logs.py' };
    }

    // Create a temp output directory
    const tempDir = path.join(app.getPath('temp'), `capsule_anon_${Date.now()}`);

    const pythonBin = process.platform === 'win32' ? 'python' : 'python3';
    const args = [scriptPath, projDir, tempDir, '--keep-paths', '--overwrite'];
    if (termsPath) args.push('--terms', termsPath);

    return new Promise((resolve) => {
      const proc = execFile(pythonBin, args, { maxBuffer: 50 * 1024 * 1024 }, (error, stdout, stderr) => {
        if (error) {
          try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
          resolve({ success: false, error: stderr || error.message, stdout });
          return;
        }

        // Find the anonymized project.json and replace the original
        const anonJsonPath = path.join(tempDir, 'project.json');
        if (fs.existsSync(anonJsonPath)) {
          const anonContent = fs.readFileSync(anonJsonPath, 'utf-8');
          fs.writeFileSync(jsonPath, anonContent, 'utf-8');
        }

        // Mark the project as anonymized so the UI can show the correct status
        try {
          const finalProject = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
          finalProject.anonymized = true;
          fs.writeFileSync(jsonPath, JSON.stringify(finalProject, null, 2), 'utf-8');
        } catch {}

        // Read anonymization report
        const reportPath = path.join(tempDir, 'anonymization_report.json');
        let report = null;
        if (fs.existsSync(reportPath)) {
          try {
            report = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
          } catch {}
        }

        // Clean up temp dir
        try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}

        resolve({ success: true, stdout, report });
      });
    });
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ============================================================================
// IPC: App Info
// ============================================================================

ipcMain.handle('get-app-version', async () => {
  return app.getVersion();
});

ipcMain.handle('open-external', async (event, url) => {
  shell.openExternal(url);
  return { success: true };
});
