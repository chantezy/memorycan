const fs = require('fs');
const path = require('path');

// ============================================================================
// sql.js initialization (pure JS SQLite, no native compilation needed)
// ============================================================================
let _SQL = null;

async function getSQL() {
  if (!_SQL) {
    const initSqlJs = require('sql.js');
    _SQL = await initSqlJs();
  }
  return _SQL;
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function titleFromText(text) {
  if (!text) return '未命名对话';
  const clean = text.replace(/[#*`>\-]/g, '').replace(/\n/g, ' ').trim();
  return clean.slice(0, 60) || '未命名对话';
}

// ============================================================================
// Message filtering — drop abnormal/unreadable messages before storage
// ============================================================================
function isReadableContent(content) {
  if (typeof content !== 'string') return false;
  const s = content.trim();
  if (!s) return false;
  if (s === '[object Object]') return false;
  return true;
}

function filterMessages(messages) {
  return messages.filter((m) => {
    if (!m || typeof m !== 'object') return false;
    if (!isReadableContent(m.content)) return false;
    if (m.role === 'system' && m.content.trim().length < 5) return false;
    return true;
  });
}

function sanitizeConversations(conversations) {
  for (const c of conversations) {
    c.messages = filterMessages(c.messages || []);
  }
  return conversations;
}

function extractContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map(c => {
      if (typeof c === 'string') return c;
      if (c.type === 'text') return c.text || '';
      if (c.type === 'tool_use') return `🔧 调用工具: ${c.name}\n参数: ${JSON.stringify(c.input, null, 2)}`;
      if (c.type === 'tool_result') return `📋 工具结果: ${typeof c.content === 'string' ? c.content : JSON.stringify(c.content)}`;
      return '';
    }).filter(Boolean).join('\n\n');
  }
  if (content && typeof content === 'object') return JSON.stringify(content, null, 2);
  return '';
}

function extractThinking(content) {
  if (Array.isArray(content)) {
    return content.filter(c => c.type === 'thinking').map(c => c.thinking || '').join('\n');
  }
  return '';
}

// Trae stores model ids like "solo_work_lite_3_openai_openai//mimo-v2.5-pro".
// Strip the prefix and return the human-readable model name.
function cleanModelId(id) {
  if (!id || typeof id !== 'string') return '';
  const s = id.trim();
  if (!s) return '';
  if (s.includes('//')) return s.split('//').pop();
  // fallback: take last segment after underscores if it looks like a model
  const parts = s.split('_');
  const last = parts[parts.length - 1];
  return /[a-z]/i.test(last) ? last : s;
}

// ============================================================================
// DB helpers (sql.js based)
// ============================================================================
function openDB(dbPath) {
  const sql = _SQL;
  const buffer = fs.readFileSync(dbPath);
  return new sql.Database(buffer);
}

function queryAll(db, sql, params) {
  const stmt = db.prepare(sql);
  if (params) stmt.bind(params);
  const results = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

function getTables(db) {
  const rows = queryAll(db, "SELECT name FROM sqlite_master WHERE type='table'");
  return rows.map(r => r.name);
}

// ============================================================================
// Cursor Parser
// ============================================================================
async function parseCursor(basePath) {
  const conversations = [];
  const parsedComposers = new Set();

  // Parse workspace storage FIRST so conversations get their real projectPath
  // from workspace.json. The same conversations also exist in global storage,
  // but we want the workspace copy (with projectPath) to win — if we parsed
  // global first, dedup would skip the workspace copies and we'd lose the path.
  const wsStorage = path.join(basePath, 'workspaceStorage');
  if (fs.existsSync(wsStorage)) {
    try {
      for (const dir of fs.readdirSync(wsStorage)) {
        const dbPath = path.join(wsStorage, dir, 'state.vscdb');
        if (fs.existsSync(dbPath)) {
          // Read workspace.json to get the real project folder path.
          let wsProjectPath = '';
          try {
            const wsJson = JSON.parse(fs.readFileSync(path.join(wsStorage, dir, 'workspace.json'), 'utf-8'));
            if (wsJson.folder) wsProjectPath = wsJson.folder.replace(/^file:\/\//, '');
          } catch {}
          try {
            const convs = await parseCursorDB(dbPath, `workspace:${dir}`);
            for (const conv of convs) {
              if (!parsedComposers.has(conv.id)) {
                if (wsProjectPath) conv.projectPath = wsProjectPath;
                conversations.push(conv);
                parsedComposers.add(conv.id);
              }
            }
          } catch {}
        }
      }
    } catch {}
  }

  // Parse global storage — conversations already seen in workspace storage are skipped.
  const globalDbPath = path.join(basePath, 'globalStorage/state.vscdb');
  if (fs.existsSync(globalDbPath)) {
    try {
      const convs = await parseCursorDB(globalDbPath, 'global');
      for (const conv of convs) {
        if (!parsedComposers.has(conv.id)) {
          conversations.push(conv);
          parsedComposers.add(conv.id);
        }
      }
    } catch (e) {
      console.error('[sqlite-parser] Cursor global parse error:', e.message);
    }
  }

  return sanitizeConversations(conversations);
}

async function parseCursorDB(dbPath, context) {
  const db = openDB(dbPath);
  const conversations = [];

  try {
    const tables = getTables(db);

    if (tables.includes('cursorDiskKV')) {
      const composers = queryAll(db,
        "SELECT key, value FROM cursorDiskKV WHERE key LIKE 'composerData:%' ORDER BY rowid DESC"
      );

      for (const { key, value } of composers) {
        try {
          const composer = JSON.parse(value);
          const composerId = composer.composerId || key.replace('composerData:', '');

          // Get all bubbles for this composer
          const bubbles = queryAll(db,
            "SELECT key, value FROM cursorDiskKV WHERE key LIKE ? ORDER BY rowid ASC",
            [`bubbleId:${composerId}:%`]
          );

          if (bubbles.length === 0) continue;

          const messages = [];
          const composerModel =
            composer.modelConfig && composer.modelConfig.modelName &&
            composer.modelConfig.modelName !== 'default'
              ? composer.modelConfig.modelName
              : '';
          for (const bubble of bubbles) {
            try {
              const msg = JSON.parse(bubble.value);
              messages.push({
                id: msg.bubbleId || uid(),
                role: msg.type === 1 ? 'user' : 'assistant',
                content: msg.text || msg.richText || '',
                thinking: '',
                timestamp: typeof msg.createdAt === 'number'
                  ? new Date(msg.createdAt).toISOString()
                  : (msg.createdAt || ''),
                model: msg.type === 1 ? '' : composerModel,
              });
            } catch {}
          }

          if (messages.length > 0) {
            const firstUser = messages.find(m => m.role === 'user');
            conversations.push({
              id: uid(),
              title: titleFromText(firstUser?.content || composerId),
              source: 'cursor',
              sourceFile: `${dbPath} (${context})`,
              sourceComposerId: composerId,
              projectPath: '',
              createdAt: typeof composer.createdAt === 'number'
                ? new Date(composer.createdAt).toISOString()
                : '',
              updatedAt: messages[messages.length - 1]?.timestamp || '',
              messages,
            });
          }
        } catch {}
      }
    }
  } finally {
    db.close();
  }

  return conversations;
}

// ============================================================================
// Trae Parser
// ============================================================================
async function parseTrae(basePath) {
  const conversations = [];

  // Parse global storage DB
  const globalDbPath = path.join(basePath, 'globalStorage/state.vscdb');
  if (fs.existsSync(globalDbPath)) {
    try {
      const convs = await parseTraeDB(globalDbPath);
      conversations.push(...convs);
    } catch (e) {
      console.error('[sqlite-parser] Trae global parse error:', e.message);
    }
  }

  // Parse workspace storage DBs
  const wsStorage = path.join(basePath, 'workspaceStorage');
  if (fs.existsSync(wsStorage)) {
    try {
      for (const dir of fs.readdirSync(wsStorage)) {
        const dbPath = path.join(wsStorage, dir, 'state.vscdb');
        if (fs.existsSync(dbPath)) {
          try {
            const convs = await parseTraeDB(dbPath);
            conversations.push(...convs);
          } catch {}
        }
      }
    } catch {}
  }

  // Parse ModularData AI agent DB
  const agentDbPath = path.join(basePath, '../ModularData/ai-agent/database.db');
  if (fs.existsSync(agentDbPath)) {
    try {
      const convs = await parseTraeAgentDB(agentDbPath);
      conversations.push(...convs);
    } catch (e) {
      console.error('[sqlite-parser] Trae agent DB parse error:', e.message);
    }
  }

  return conversations;
}

async function parseTraeDB(dbPath) {
  const db = openDB(dbPath);
  const conversations = [];

  try {
    const tables = getTables(db);

    if (!tables.includes('ItemTable')) {
      db.close();
      return [];
    }

    // Load Trae's per-session selected model map (real model names, e.g. mimo-v2.5-pro)
    let modelMap = {};
    let recentSel = {};
    try {
      const selRows = queryAll(db,
        "SELECT value FROM ItemTable WHERE key LIKE '%AI.agent.model.session_selected_model'"
      );
      if (selRows.length) modelMap = JSON.parse(selRows[selRows.length - 1].value) || {};
      const rRows = queryAll(db,
        "SELECT value FROM ItemTable WHERE key LIKE '%AI.agent.model.recent_user_selection_by%'"
      );
      if (rRows.length) recentSel = JSON.parse(rRows[rRows.length - 1].value) || {};
    } catch {}
    const modelFor = (sessionId, mode) => {
      const agentKey = mode === 'code' ? 'solo_agent_lite' : 'solo_work_lite';
      const entry = modelMap[sessionId];
      let id = '';
      if (entry) {
        const m = entry[agentKey] || entry.solo_agent_lite || entry.solo_work_lite || {};
        id = m.modelId || '';
      }
      if (!id && recentSel[agentKey]) id = recentSel[agentKey].modelId || '';
      return cleanModelId(id);
    };

    // Look for draft session keys
    const draftKeys = queryAll(db,
      "SELECT key, value FROM ItemTable WHERE key LIKE '%draft:session:%'"
    );

    // Group by sessionId
    const sessions = {};
    for (const { key, value } of draftKeys) {
      const match = key.match(/draft:session:([^:]+):(\w+)/);
      if (match) {
        const sessionId = match[1];
        const mode = match[2];
        if (!sessions[sessionId]) sessions[sessionId] = {};
        try {
          sessions[sessionId][mode] = JSON.parse(value);
        } catch {
          sessions[sessionId][mode] = value;
        }
      }
    }

    // Look for AI agent storage (memento)
    const agentKeys = queryAll(db,
      "SELECT key, value FROM ItemTable WHERE key LIKE '%ai-agent%' OR key LIKE '%icube%' OR key LIKE '%chat%'"
    );

    for (const { key, value } of agentKeys) {
      try {
        const parsed = JSON.parse(value);
        // Trae format: {list: [{sessionId, messages}]}
        if (parsed.list && Array.isArray(parsed.list)) {
          for (const session of parsed.list) {
            const messages = [];
            let title = '';
            const mdl = modelFor(session.sessionId, session.mode);
            for (const msg of (session.messages || [])) {
              const role = msg.role || 'user';
              let content = msg.content || '';
              if (msg.agentTaskContent) {
                if (msg.agentTaskContent.proposal) content = msg.agentTaskContent.proposal;
                if (msg.agentTaskContent.proposalReasoningContent) {
                  content = msg.agentTaskContent.proposalReasoningContent + '\n\n' + content;
                }
              }
              if (!title && role === 'user') title = titleFromText(content);
              messages.push({
                id: uid(), role, content,
                thinking: '', timestamp: msg.timestamp || '',
                model: role === 'assistant' ? mdl : '',
              });
            }
            if (messages.length > 0) {
              conversations.push({
                id: uid(),
                title: title || session.sessionId || 'Trae 会话',
                source: 'trae',
                sourceFile: dbPath,
                projectPath: '',
                createdAt: session.createdAt ? new Date(session.createdAt).toISOString() : '',
                updatedAt: session.updatedAt ? new Date(session.updatedAt).toISOString() : '',
                messages,
              });
            }
          }
        }
      } catch {}
    }

    // Also try to parse draft sessions
    for (const [sessionId, modes] of Object.entries(sessions)) {
      const mode = modes.work ? 'work' : 'code';
      const workDraft = modes.work || modes.code;
      if (workDraft && workDraft.editorState) {
        try {
          const text = extractTextFromLexical(workDraft.editorState);
          if (text && text.trim()) {
            conversations.push({
              id: uid(),
              title: titleFromText(text),
              source: 'trae',
              sourceFile: dbPath,
              projectPath: '',
              createdAt: workDraft.updatedAt ? new Date(workDraft.updatedAt).toISOString() : '',
              updatedAt: workDraft.updatedAt ? new Date(workDraft.updatedAt).toISOString() : '',
              messages: [{
                id: uid(), role: 'user', content: text,
                thinking: '', timestamp: '', model: modelFor(sessionId, mode),
              }],
            });
          }
        } catch {}
      }
    }
  } finally {
    db.close();
  }

  return sanitizeConversations(conversations);
}

function extractTextFromLexical(editorState) {
  if (!editorState || !editorState.root || !editorState.root.children) return '';
  let text = '';
  function walk(node) {
    if (node.text) text += node.text;
    if (node.children) node.children.forEach(walk);
  }
  editorState.root.children.forEach(walk);
  return text;
}

async function parseTraeAgentDB(dbPath) {
  const db = openDB(dbPath);
  const conversations = [];

  try {
    const tables = getTables(db);

    // Try common table names
    for (const table of tables) {
      try {
        const rows = queryAll(db, `SELECT * FROM "${table}" LIMIT 100`);
        for (const row of rows) {
          // Try to find conversation-like data
          for (const [key, value] of Object.entries(row)) {
            if (typeof value === 'string' && (value.includes('"role"') || value.includes('"messages"'))) {
              try {
                const parsed = JSON.parse(value);
                if (parsed.messages || (parsed.list && parsed.list[0]?.messages)) {
                  const msgList = parsed.messages || parsed.list[0].messages;
                  const messages = msgList.map(m => ({
                    id: uid(),
                    role: m.role || 'user',
                    content: m.content || (m.agentTaskContent?.proposal || ''),
                    thinking: m.agentTaskContent?.proposalReasoningContent || '',
                    timestamp: m.timestamp || '',
                  }));
                  if (messages.length > 0) {
                    conversations.push({
                      id: uid(),
                      title: titleFromText(messages.find(m => m.role === 'user')?.content || ''),
                      source: 'trae',
                      sourceFile: dbPath,
                      projectPath: '',
                      createdAt: '',
                      updatedAt: '',
                      messages,
                    });
                  }
                }
              } catch {}
            }
          }
        }
      } catch {}
    }
  } finally {
    db.close();
  }

  return conversations;
}

// ============================================================================
// VS Code Copilot Parser (reads files, not SQLite DBs)
// ============================================================================
function parseVSCode(basePath) {
  const conversations = [];

  const globalSessions = path.join(basePath, 'globalStorage/emptyWindowChatSessions');
  if (fs.existsSync(globalSessions)) {
    try {
      for (const file of fs.readdirSync(globalSessions)) {
        if (file.endsWith('.jsonl') || file.endsWith('.json')) {
          const filePath = path.join(globalSessions, file);
          try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const convs = parseVSCodeFile(content, file, filePath);
            conversations.push(...convs);
          } catch {}
        }
      }
    } catch {}
  }

  const wsStorage = path.join(basePath, 'workspaceStorage');
  if (fs.existsSync(wsStorage)) {
    try {
      for (const dir of fs.readdirSync(wsStorage)) {
        const chatDir = path.join(wsStorage, dir, 'chatSessions');
        if (fs.existsSync(chatDir)) {
          for (const file of fs.readdirSync(chatDir)) {
            if (file.endsWith('.jsonl') || file.endsWith('.json')) {
              const filePath = path.join(chatDir, file);
              try {
                const content = fs.readFileSync(filePath, 'utf-8');
                const convs = parseVSCodeFile(content, file, filePath);
                conversations.push(...convs);
              } catch {}
            }
          }
        }
      }
    } catch {}
  }

  return sanitizeConversations(conversations);
}

function parseVSCodeFile(content, filename, filePath) {
  const conversations = [];
  const ext = filename.split('.').pop().toLowerCase();

  if (ext === 'jsonl') {
    const lines = content.split('\n').filter(l => l.trim());
    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        if (obj.kind === 0 && obj.v) {
          const conv = parseVSCodeSession(obj.v, filename, filePath);
          if (conv) conversations.push(conv);
        }
      } catch {}
    }
  } else if (ext === 'json') {
    try {
      const obj = JSON.parse(content);
      if (obj.requests) {
        const conv = parseVSCodeSession(obj, filename, filePath);
        if (conv) conversations.push(conv);
      }
    } catch {}
  }

  return conversations;
}

function parseVSCodeSession(session, filename, filePath) {
  if (!session || !session.requests) return null;
  const messages = [];
  let title = session.customTitle || '';

  for (const req of session.requests) {
    const userText = req.message?.text || '';
    if (!title && userText) title = titleFromText(userText);
    messages.push({
      id: req.requestId || uid(),
      role: 'user',
      content: userText,
      timestamp: req.timestamp ? new Date(req.timestamp).toISOString() : '',
    });

    if (req.response && Array.isArray(req.response)) {
      const parts = [];
      let thinking = '';
      for (const r of req.response) {
        if (r.kind === 'text' && r.value) parts.push(r.value);
        else if (r.kind === 'thinking' && r.value) thinking += r.value;
        else if (r.kind === 'toolInvocationSerialized') {
          parts.push(`🔧 工具调用: ${r.toolInvocation?.toolName || ''}`);
        }
      }
      if (parts.length || thinking) {
        messages.push({
          id: uid(),
          role: 'assistant',
          content: parts.join('\n'),
          thinking,
          timestamp: req.timestamp ? new Date(req.timestamp).toISOString() : '',
        });
      }
    }
  }

  return {
    id: uid(),
    title: title || filename,
    source: 'vscode-copilot',
    sourceFile: filePath,
    projectPath: '',
    createdAt: session.creationDate ? new Date(session.creationDate).toISOString() : '',
    updatedAt: '',
    messages,
  };
}

// ============================================================================
// Claude Code Parser (JSONL)
// ============================================================================
function parseClaudeCode(basePath) {
  const conversations = [];

  if (!fs.existsSync(basePath)) return conversations;

  try {
    for (const projDir of fs.readdirSync(basePath)) {
      const projPath = path.join(basePath, projDir);
      try {
        if (!fs.statSync(projPath).isDirectory()) continue;
        for (const file of fs.readdirSync(projPath)) {
          if (!file.endsWith('.jsonl')) continue;
          const filePath = path.join(projPath, file);
          try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const conv = parseClaudeCodeJSONL(content, file, filePath, projDir);
            if (conv) conversations.push(conv);
          } catch {}
        }
      } catch {}
    }
  } catch {}

  return sanitizeConversations(conversations);
}

function parseClaudeCodeJSONL(text, filename, filePath, projDir) {
  const lines = text.split('\n').filter(l => l.trim());
  if (lines.length === 0) return null;

  const messages = [];
  let title = '';
  let createdAt = '';
  let projectPath = '';

  if (projDir.startsWith('-')) {
    projectPath = projDir.replace(/^-/, '/');
  }

  for (const line of lines) {
    let obj;
    try { obj = JSON.parse(line); } catch { continue; }

    if (obj.type === 'user' || obj.type === 'assistant') {
      const role = obj.message?.role || obj.type;
      const content = extractContent(obj.message?.content);
      const thinking = extractThinking(obj.message?.content);
      if (!title && role === 'user') title = titleFromText(content);
      if (!createdAt && obj.timestamp) createdAt = obj.timestamp;
      if (!projectPath && obj.cwd) projectPath = obj.cwd;

      messages.push({
        id: obj.uuid || uid(),
        role,
        content,
        thinking,
        timestamp: obj.timestamp || '',
        model: obj.message?.model || '',
      });
    } else if (obj.type === 'system') {
      messages.push({
        id: obj.uuid || uid(),
        role: 'system',
        content: obj.content || obj.error?.message || '',
        timestamp: obj.timestamp || '',
      });
    }
  }

  if (messages.length === 0) return null;

  return {
    id: uid(),
    title: title || filename,
    source: 'claude-code',
    sourceFile: filePath,
    projectPath,
    createdAt,
    updatedAt: createdAt,
    messages,
  };
}

// ============================================================================
// Codex CLI Parser (JSONL)
// ============================================================================
function parseCodex(basePath) {
  const conversations = [];

  if (!fs.existsSync(basePath)) return conversations;

  try {
    for (const dir of fs.readdirSync(basePath)) {
      const sessionPath = path.join(basePath, dir);
      try {
        if (!fs.statSync(sessionPath).isDirectory()) continue;
        for (const file of fs.readdirSync(sessionPath)) {
          if (!file.endsWith('.jsonl')) continue;
          const filePath = path.join(sessionPath, file);
          try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const convs = parseCodexJSONL(content, file, filePath);
            conversations.push(...convs);
          } catch {}
        }
      } catch {}
    }
  } catch {}

  return conversations;
}

function parseCodexJSONL(text, filename, filePath) {
  const lines = text.split('\n').filter(l => l.trim());
  if (lines.length === 0) return [];

  const conversations = [];
  let currentMessages = [];
  let currentMeta = {};
  let title = '';

  for (const line of lines) {
    let obj;
    try { obj = JSON.parse(line); } catch { continue; }

    if (obj.type === 'session_meta') {
      if (currentMessages.length > 0) {
        conversations.push({
          id: uid(),
          title: title || `${filename} #${conversations.length + 1}`,
          source: 'codex',
          sourceFile: filePath,
          projectPath: currentMeta.cwd || '',
          createdAt: currentMessages[0]?.timestamp || '',
          updatedAt: currentMessages[currentMessages.length - 1]?.timestamp || '',
          messages: currentMessages,
        });
      }
      currentMessages = [];
      currentMeta = obj.payload || {};
      title = '';
    } else if (obj.type === 'event_msg') {
      const p = obj.payload;
      if (p.type === 'user_message') {
        if (!title) title = titleFromText(p.message);
        currentMessages.push({ id: uid(), role: 'user', content: p.message, timestamp: obj.timestamp || '' });
      } else if (p.type === 'agent_message') {
        currentMessages.push({ id: uid(), role: 'assistant', content: p.message, timestamp: obj.timestamp || '', model: p.model || '' });
      }
    } else if (obj.type === 'response_item') {
      const p = obj.payload;
      if (p.type === 'message' && p.role) {
        const content = Array.isArray(p.content)
          ? p.content.map(c => c.text || '').join('\n')
          : (typeof p.content === 'string' ? p.content : JSON.stringify(p.content));
        if (!title && p.role === 'user') title = titleFromText(content);
        currentMessages.push({ id: uid(), role: p.role, content, timestamp: '', model: (p.role === 'assistant' ? (p.model || '') : '') });
      } else if (p.type === 'function_call') {
        currentMessages.push({
          id: uid(), role: 'tool',
          content: `调用工具: ${p.name}\n参数: ${JSON.stringify(p.arguments, null, 2)}`,
          timestamp: '',
        });
      }
    }
  }

  if (currentMessages.length > 0) {
    conversations.push({
      id: uid(),
      title: title || filename,
      source: 'codex',
      sourceFile: filePath,
      projectPath: currentMeta.cwd || '',
      createdAt: currentMessages[0]?.timestamp || '',
      updatedAt: currentMessages[currentMessages.length - 1]?.timestamp || '',
      messages: currentMessages,
    });
  }

  return sanitizeConversations(conversations);
}

// ============================================================================
// Generic File Parser
// ============================================================================
function parseFile(filePath) {
  const ext = path.extname(filePath).toLowerCase().slice(1);
  const filename = path.basename(filePath);
  const content = fs.readFileSync(filePath, 'utf-8');

  let conversations = [];
  if (ext === 'jsonl' || ext === 'log') {
    conversations = parseJSONLFile(content, filename, filePath);
  } else if (ext === 'json') {
    conversations = parseJSONFile(content, filename, filePath);
  } else if (ext === 'md' || ext === 'markdown') {
    conversations = [parseMarkdownFile(content, filename, filePath)];
  } else if (ext === 'txt' || ext === 'text') {
    conversations = [parseTextFile(content, filename, filePath)];
  } else {
    try { conversations = parseJSONLFile(content, filename, filePath); } catch {}
    if (conversations.length === 0) {
      try { conversations = parseJSONFile(content, filename, filePath); } catch {}
    }
    if (conversations.length === 0) {
      conversations = [parseTextFile(content, filename, filePath)];
    }
  }
  return sanitizeConversations(conversations);
}

function parseJSONLFile(text, filename, filePath) {
  const lines = text.split('\n').filter(l => l.trim());
  if (lines.length === 0) throw new Error('Empty file');

  const first = JSON.parse(lines[0]);

  // Claude Code
  if (first.type === 'user' || first.type === 'assistant' || first.type === 'system') {
    const conv = parseClaudeCodeJSONL(text, filename, filePath, '');
    return conv ? [conv] : [];
  }
  // Codex
  if (first.type === 'event_msg' || first.type === 'session_meta' || first.type === 'response_item') {
    return parseCodexJSONL(text, filename, filePath);
  }
  // VS Code Copilot JSONL
  if (first.kind !== undefined && first.v) {
    const conversations = [];
    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        if (obj.kind === 0 && obj.v) {
          const conv = parseVSCodeSession(obj.v, filename, filePath);
          if (conv) conversations.push(conv);
        }
      } catch {}
    }
    return conversations;
  }
  // Generic
  if (first.role && first.content !== undefined) {
    const messages = [];
    let title = '';
    let createdAt = '';
    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        if (obj.role && obj.content !== undefined) {
          const content = typeof obj.content === 'string' ? obj.content : JSON.stringify(obj.content, null, 2);
          if (!title && obj.role === 'user') title = titleFromText(content);
          if (!createdAt && obj.timestamp) createdAt = obj.timestamp;
          messages.push({
            id: obj.id || uid(), role: obj.role, content,
            thinking: obj.thinking || '',
            timestamp: obj.timestamp || obj.createdAt || '',
            model: obj.model || '',
          });
        }
      } catch {}
    }
    return [{
      id: uid(), title: title || filename, source: 'generic',
      sourceFile: filePath, projectPath: '', createdAt, updatedAt: createdAt,
      messages,
    }];
  }

  throw new Error('Unknown JSONL format');
}

function parseJSONFile(text, filename, filePath) {
  const obj = JSON.parse(text);

  if (obj.requests) {
    const conv = parseVSCodeSession(obj, filename, filePath);
    return conv ? [conv] : [];
  }
  if (obj.messages && Array.isArray(obj.messages)) {
    return [{
      id: uid(),
      title: obj.title || titleFromText(obj.messages.find(m => m.role === 'user')?.content || ''),
      source: obj.source || 'generic', sourceFile: filePath,
      projectPath: obj.projectPath || '',
      createdAt: obj.createdAt || '', updatedAt: obj.updatedAt || '',
      messages: obj.messages.map(m => ({
        id: m.id || uid(), role: m.role || 'user',
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content, null, 2),
        thinking: m.thinking || '',
        timestamp: m.timestamp || '',
        model: m.model || '',
      })),
    }];
  }
  if (Array.isArray(obj) && obj.length > 0 && obj[0].role) {
    return [{
      id: uid(), title: titleFromText(obj.find(m => m.role === 'user')?.content || ''),
      source: 'generic', sourceFile: filePath, projectPath: '',
      createdAt: '', updatedAt: '',
      messages: obj.map(m => ({
        id: m.id || uid(), role: m.role || 'user',
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content, null, 2),
        thinking: m.thinking || '', timestamp: m.timestamp || '',
        model: m.model || '',
      })),
    }];
  }

  throw new Error('Unknown JSON format');
}

function parseMarkdownFile(text, filename, filePath) {
  const messages = [];
  const sections = text.split(/^##\s+/m);
  let title = '';

  for (let section of sections) {
    if (!section.trim()) continue;
    const lines = section.split('\n');
    const header = lines[0].trim().toLowerCase();
    const body = lines.slice(1).join('\n').trim();

    let role = 'user';
    if (header.includes('assistant') || header.includes('ai') || header.includes('bot')) role = 'assistant';
    else if (header.includes('system')) role = 'system';
    else if (header.includes('user') || header.includes('human') || header.includes('me')) role = 'user';
    else if (messages.length === 0) {
      if (!title) title = header.slice(0, 60);
      continue;
    }

    if (body) {
      if (!title && role === 'user') title = titleFromText(body);
      messages.push({ id: uid(), role, content: body, thinking: '', timestamp: '' });
    }
  }

  if (messages.length === 0) {
    messages.push({ id: uid(), role: 'user', content: text, thinking: '', timestamp: '' });
    title = filename;
  }

  return {
    id: uid(), title: title || filename, source: 'generic',
    sourceFile: filePath, projectPath: '', createdAt: '', updatedAt: '',
    messages,
  };
}

function parseTextFile(text, filename, filePath) {
  const messages = [];
  const rolePattern = /^(user|assistant|human|ai|bot|system|you|me)[:：]\s*/i;
  const lines = text.split('\n');
  let currentRole = null;
  let currentContent = [];

  for (const line of lines) {
    const match = line.match(rolePattern);
    if (match) {
      if (currentRole && currentContent.length > 0) {
        messages.push({ id: uid(), role: currentRole, content: currentContent.join('\n').trim(), thinking: '', timestamp: '' });
      }
      const r = match[1].toLowerCase();
      currentRole = (r === 'human' || r === 'me' || r === 'you') ? 'user' :
                    (r === 'ai' || r === 'bot') ? 'assistant' : r;
      currentContent = [line.replace(rolePattern, '')];
    } else {
      currentContent.push(line);
    }
  }
  if (currentRole && currentContent.length > 0) {
    messages.push({ id: uid(), role: currentRole, content: currentContent.join('\n').trim(), thinking: '', timestamp: '' });
  }
  if (messages.length === 0) {
    messages.push({ id: uid(), role: 'user', content: text, thinking: '', timestamp: '' });
  }

  return {
    id: uid(), title: titleFromText(messages.find(m => m.role === 'user')?.content || filename),
    source: 'generic', sourceFile: filePath, projectPath: '', createdAt: '', updatedAt: '',
    messages,
  };
}

module.exports = {
  parseCursor, parseTrae, parseVSCode,
  parseClaudeCode, parseCodex, parseFile,
  getSQL, // Export for initialization
};
