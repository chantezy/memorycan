const path = require('path');
const fs = require('fs');
const os = require('os');

// Known AI agent conversation storage locations
const SOURCES = [
  {
    id: 'cursor',
    name: 'Cursor',
    icon: '🔵',
    paths: {
      darwin: path.join(os.homedir(), 'Library/Application Support/Cursor/User'),
      win32: path.join(os.homedir(), 'AppData/Roaming/Cursor/User'),
      linux: path.join(os.homedir(), '.config/Cursor/User'),
    },
    type: 'sqlite-cursor',
    description: 'Cursor IDE 对话记录（SQLite 数据库）',
  },
  {
    id: 'trae',
    name: 'Trae',
    icon: '🟣',
    paths: {
      darwin: path.join(os.homedir(), 'Library/Application Support/TRAE SOLO CN/User'),
      win32: '',
      linux: '',
    },
    type: 'sqlite-trae',
    description: 'Trae IDE 对话记录（SQLite 数据库）',
  },
  {
    id: 'claude-code',
    name: 'Claude Code',
    icon: '🟡',
    binary: 'claude',
    paths: {
      darwin: path.join(os.homedir(), '.claude/projects'),
      win32: path.join(os.homedir(), '.claude/projects'),
      linux: path.join(os.homedir(), '.claude/projects'),
    },
    type: 'jsonl-claude',
    description: 'Claude Code CLI 对话记录（JSONL）',
  },
  {
    id: 'vscode-copilot',
    name: 'VS Code Copilot',
    icon: '🟢',
    paths: {
      darwin: path.join(os.homedir(), 'Library/Application Support/Code/User'),
      win32: path.join(os.homedir(), 'AppData/Roaming/Code/User'),
      linux: path.join(os.homedir(), '.config/Code/User'),
    },
    type: 'sqlite-vscode',
    description: 'VS Code Copilot Chat 对话记录',
  },
  {
    id: 'windsurf',
    name: 'Windsurf',
    icon: '🌊',
    paths: {
      darwin: path.join(os.homedir(), 'Library/Application Support/Windsurf/User'),
      win32: path.join(os.homedir(), 'AppData/Roaming/Windsurf/User'),
      linux: path.join(os.homedir(), '.config/Windsurf/User'),
    },
    type: 'sqlite-vscode',
    description: 'Windsurf Cascade 对话记录',
  },
  {
    id: 'codex',
    name: 'Codex CLI',
    icon: '🔴',
    binary: 'codex',
    paths: {
      darwin: path.join(os.homedir(), '.codex/sessions'),
      win32: path.join(os.homedir(), '.codex/sessions'),
      linux: path.join(os.homedir(), '.codex/sessions'),
    },
    type: 'jsonl-codex',
    description: 'OpenAI Codex CLI 对话记录（JSONL）',
  },
  {
    id: 'codex-desktop',
    name: 'Codex',
    icon: '🟣',
    // ChatGPT 桌面版 Codex（基于 Chromium），数据存在 Local Storage / IndexedDB
    paths: {
      darwin: path.join(os.homedir(), 'Library/Application Support/Codex'),
      win32: path.join(os.homedir(), 'AppData/Roaming/Codex'),
      linux: path.join(os.homedir(), '.config/Codex'),
    },
    type: 'app-codex-desktop',
    description: 'ChatGPT 桌面版 Codex（推荐用「导入文件夹」）',
  },
  {
    id: 'claude-desktop',
    name: 'Claude',
    icon: '🟡',
    // Anthropic Claude 桌面应用（Electron），数据存在本地
    paths: {
      darwin: path.join(os.homedir(), 'Library/Application Support/Claude'),
      win32: path.join(os.homedir(), 'AppData/Roaming/Claude'),
      linux: path.join(os.homedir(), '.config/Claude'),
    },
    type: 'app-claude-desktop',
    description: 'Claude 桌面应用（推荐用「导入文件夹」）',
  },
  {
    id: 'cindy',
    name: 'Cindy',
    icon: '🌸',
    // Cindy 的桌面应用数据目录（Electron 应用），不是 CLI 工具
    paths: {
      darwin: path.join(os.homedir(), 'Library/Application Support/Cindy'),
      win32: path.join(os.homedir(), 'AppData/Roaming/Cindy'),
      linux: path.join(os.homedir(), '.config/Cindy'),
    },
    type: 'app-cindy',
    description: 'Cindy 桌面应用（推荐用「导入文件夹」）',
  },
  {
    id: 'codebuddy',
    name: 'CodeBuddy',
    icon: '🟠',
    // Codebuddy 由 WorkBuddy 改名而来，本地数据目录可能是旧名 ~/.workbuddy
    // 或新名 ~/.codebuddy，两者都要扫描以兼容升级前后的安装。
    paths: {
      darwin: path.join(os.homedir(), '.codebuddy'),
      win32: path.join(os.homedir(), '.codebuddy'),
      linux: path.join(os.homedir(), '.codebuddy'),
    },
    altPaths: {
      darwin: path.join(os.homedir(), '.workbuddy'),
      win32: path.join(os.homedir(), '.workbuddy'),
      linux: path.join(os.homedir(), '.workbuddy'),
    },
    type: 'app-workbuddy',
    description: 'CodeBuddy（对话保存在云端，推荐用「导入文件夹」）',
  },
  {
    id: 'qoder',
    name: 'Qoder',
    icon: '🔷',
    paths: {
      darwin: path.join(os.homedir(), 'Library/Application Support/Qoder/User'),
      win32: path.join(os.homedir(), 'AppData/Roaming/Qoder/User'),
      linux: path.join(os.homedir(), '.config/Qoder/User'),
    },
    type: 'sqlite-vscode',
    description: 'Qoder IDE 对话记录（SQLite 数据库）',
  },
];

// For CLI-style agents (Claude Code, Codex), the data directory (e.g.
// ~/.claude/projects, ~/.codex/sessions) lingers after uninstall, so merely
// checking directory existence yields false "已安装". The reliable signal is
// whether the executable is actually on PATH.
function binaryExists(name) {
  try {
    const { execSync } = require('child_process');
    execSync(process.platform === 'win32' ? `where ${name}` : `command -v ${name}`, {
      stdio: 'ignore',
    });
    return true;
  } catch {
    // GUI apps on macOS/Linux often have a restricted PATH that excludes
    // ~/.local/bin, /usr/local/bin, etc. Fall back to checking common
    // install locations directly.
    const home = os.homedir();
    const candidates = [
      path.join(home, '.local', 'bin', name),
      path.join(home, '.npm-global', 'bin', name),
      path.join('/usr/local/bin', name),
      path.join('/opt/homebrew/bin', name),
    ];
    for (const p of candidates) {
      try {
        if (fs.existsSync(p)) return true;
      } catch {}
    }
    return false;
  }
}

function detectSources() {
  const platform = process.platform;
  const results = [];

  for (const source of SOURCES) {
    const sourcePath = source.paths[platform];
    const altPath = source.altPaths?.[platform];
    const dirExists = (!!sourcePath && fs.existsSync(sourcePath)) || (!!altPath && fs.existsSync(altPath));

    // IDE-style agents: presence of the data directory is a good proxy.
    // CLI-style agents: must have the binary on PATH (data dir lingers post-uninstall).
    const exists = source.binary ? binaryExists(source.binary) : dirExists;

    let conversationCount = 0;
    let lastModified = '';

    if (dirExists) {
      try {
        const checkPath = (sourcePath && fs.existsSync(sourcePath)) ? sourcePath : altPath;
        const countResult = countConversations(source, checkPath);
        conversationCount = countResult.count;
        lastModified = countResult.lastModified;
      } catch (e) {
        console.error(`[detectors] Error counting for ${source.name}:`, e.message);
      }
    }

    results.push({
      id: source.id,
      name: source.name,
      icon: source.icon,
      type: source.type,
      description: source.description,
      path: sourcePath || '',
      exists,
      conversationCount,
      lastModified,
    });
  }

  return results;
}

function countConversations(source, basePath) {
  let count = 0;
  let lastModified = '';

  switch (source.type) {
    case 'sqlite-cursor':
    case 'sqlite-trae':
    case 'sqlite-vscode': {
      // Check global storage DB
      const globalDb = path.join(basePath, 'globalStorage/state.vscdb');
      if (fs.existsSync(globalDb)) {
        const stat = fs.statSync(globalDb);
        lastModified = stat.mtime.toISOString();
        // Can't easily count without opening DB; return -1 to indicate "needs parsing"
        count = -1;
      }
      // For VS Code, also check chatSessions directories
      if (source.type === 'sqlite-vscode') {
        count = countVSCodeChatSessions(basePath);
      }
      break;
    }

    case 'jsonl-claude': {
      if (!fs.existsSync(basePath)) break;
      for (const projDir of fs.readdirSync(basePath)) {
        const projPath = path.join(basePath, projDir);
        try {
          if (fs.statSync(projPath).isDirectory()) {
            const files = fs.readdirSync(projPath).filter(f => f.endsWith('.jsonl'));
            count += files.length;
            for (const f of files) {
              const stat = fs.statSync(path.join(projPath, f));
              if (!lastModified || stat.mtime.toISOString() > lastModified) {
                lastModified = stat.mtime.toISOString();
              }
            }
          }
        } catch {}
      }
      break;
    }

    case 'jsonl-codex': {
      if (!fs.existsSync(basePath)) break;
      for (const dir of fs.readdirSync(basePath)) {
        const sessionPath = path.join(basePath, dir);
        try {
          if (fs.statSync(sessionPath).isDirectory()) {
            const files = fs.readdirSync(sessionPath).filter(f => f.endsWith('.jsonl'));
            count += files.length;
            for (const f of files) {
              const stat = fs.statSync(path.join(sessionPath, f));
              if (!lastModified || stat.mtime.toISOString() > lastModified) {
                lastModified = stat.mtime.toISOString();
              }
            }
          }
        } catch {}
      }
      break;
    }
  }

  return { count, lastModified };
}

function countVSCodeChatSessions(basePath) {
  let count = 0;

  // Global chat sessions
  const globalSessions = path.join(basePath, 'globalStorage/emptyWindowChatSessions');
  if (fs.existsSync(globalSessions)) {
    try {
      count += fs.readdirSync(globalSessions)
        .filter(f => f.endsWith('.jsonl') || f.endsWith('.json')).length;
    } catch {}
  }

  // Workspace chat sessions
  const wsStorage = path.join(basePath, 'workspaceStorage');
  if (fs.existsSync(wsStorage)) {
    try {
      for (const dir of fs.readdirSync(wsStorage)) {
        const chatDir = path.join(wsStorage, dir, 'chatSessions');
        if (fs.existsSync(chatDir)) {
          count += fs.readdirSync(chatDir)
            .filter(f => f.endsWith('.jsonl') || f.endsWith('.json')).length;
        }
      }
    } catch {}
  }

  return count;
}

module.exports = { detectSources, SOURCES };
