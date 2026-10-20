import { useCallback, useEffect, useState } from "react";
import type { Capsule, ChatMsg } from "./data";

declare global {
  interface Window {
    api?: {
      isElectron?: boolean;
      getProjectsData?: () => Promise<{ success: boolean; data?: any; error?: string }>;
      getProjectDetail?: (key: string) => Promise<{ success: boolean; data?: any; folder?: string; error?: string }>;
      associateProjectFolder?: (key: string, projectPath: string) => Promise<{ success: boolean; folder?: string; error?: string }>;
      openProjectsFolder?: () => Promise<{ success: boolean; error?: string }>;
      projectFolderExists?: (folderName: string) => Promise<{ exists: boolean }>;
      openProjectFolder?: (folderName: string) => Promise<{ success: boolean; error?: string }>;
      collectRefresh?: () => Promise<{ success: boolean; error?: string }>;
      selectFiles?: () => Promise<{ canceled?: boolean; filePaths?: string[] }>;
      selectFolder?: () => Promise<{ canceled?: boolean; folderPath?: string }>;
      resolveDropFolder?: (paths: string[]) => Promise<{ success: boolean; folderPath?: string; error?: string }>;
      collectImportFile?: (filePath: string) => Promise<{ success: boolean; error?: string }>;
      collectImportFolder?: (folderPath: string) => Promise<{ success: boolean; error?: string }>;
      detectSources?: () => Promise<{ success: boolean; sources?: any[]; error?: string }>;
      importToProject?: (params: any) => Promise<{ success: boolean; error?: string; projectCount?: number; conversationCount?: number; projectFolder?: string; alreadyExists?: boolean }>;
      previewScan?: (params: { sourceIds: string[] }) => Promise<{
        success: boolean;
        error?: string;
        groups?: Array<{
          key: string;
          label: string;
          fullPath: string;
          agentName: string;
          conversationCount: number;
          lastModified: string;
        }>;
        totalConversations?: number;
      }>;
      getCollectionPrompt?: () => Promise<{ success: boolean; content?: string; error?: string }>;
      anonymizeProject?: (projectFolder: string, termsPath?: string) => Promise<{ success: boolean; error?: string; report?: any }>;
      updateProjectSummary?: (projectId: string, summary: string) => Promise<{ success: boolean; error?: string }>;
    };
  }
}

export interface LiveStats {
  totalProjects: number;
  totalConversations: number;
  totalMessages: number;
}

export interface UseCapsulesResult {
  capsules: Capsule[];
  stats: LiveStats;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

function stripQuotes(v: unknown): string {
  if (typeof v !== "string") return String(v ?? "");
  const s = v.trim();
  if (s.length >= 2 && s[0] === "'" && s[s.length - 1] === "'") return s.slice(1, -1);
  return s;
}

function parseDate(d: unknown): string {
  const s = stripQuotes(d);
  if (!s) return "";
  // projects.json may use YYYYMMDD strings
  if (/^\d{8}$/.test(s)) {
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  }
  // ISO timestamps like "2026-05-08T13:27:47.869Z" -> YYYY-MM-DD
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return s;
}

function getMessageTime(m: any): string | undefined {
  const ts = stripQuotes(m.timestamp || m.time);
  if (!ts) return undefined;
  // try HH:MM:SS or HH:MM
  const t = ts.split("T").pop() || ts;
  const m2 = t.match(/(\d{2}):(\d{2})(?::\d{2})?/);
  if (m2) return `${m2[1]}:${m2[2]}`;
  return undefined;
}

function getModelName(m: any): string | undefined {
  if (m.model) return stripQuotes(m.model);
  return undefined;
}

function getTimestampMs(s: unknown): number {
  if (!s) return 0;
  const d = new Date(stripQuotes(s));
  const t = d.getTime();
  return isNaN(t) ? 0 : t;
}

// Earliest real timestamp of a conversation — used to order the chat timeline
// chronologically regardless of the order conversations were imported / scanned
// from disk. Prefers the conversation's createdAt, falling back to the minimum
// message timestamp within it.
function convStartTime(conv: any): number {
  const fromConv = getTimestampMs(conv?.createdAt || conv?.updatedAt);
  let min = 0;
  for (const m of conv?.messages || []) {
    const t = getTimestampMs(m?.timestamp || m?.time);
    if (t && (min === 0 || t < min)) min = t;
  }
  return fromConv || min;
}

export function projectToCapsule(p: any): Capsule {
  const id = stripQuotes(p.id || p.folder);
  const name = stripQuotes(p.name || p.folder || "未命名项目");
  const colorPrimary = stripQuotes(p.color?.primary || p.color || "#6b8caf");
  const colorSecondary = stripQuotes(p.color?.secondary || colorPrimary);

  const startRaw = p.timeRange?.start || p.startDate || p.createdAt;
  const endRaw = p.timeRange?.end || p.endDate || p.updatedAt;
  const start = parseDate(startRaw);
  const end = parseDate(endRaw);
  // completion time (when the project's last activity happened) — used to sort
  // the home-page search list by project completion time
  const completedAtMs = getTimestampMs(endRaw) || undefined;
  const dates = start && end ? `${start.replace(/-/g, "")} | ${end.replace(/-/g, "")}` : start || "";

  const stats = p.stats || {};
  const conversationCount = Number(stripQuotes(stats.conversationCount) || stats.conversationCount || p.conversations?.length || 0);
  const messageCount = Number(stripQuotes(stats.messageCount) || stats.messageCount || 0);
  const userCount = Number(stripQuotes(stats.userMessageCount) || stats.userMessageCount || 0);
  const assistantCount = Number(stripQuotes(stats.assistantMessageCount) || stats.assistantMessageCount || 0);
  const durationH = Number(stripQuotes(stats.durationHours) || stats.durationHours || 0);

  // heatmap: projects.json has { "20260508": 3, ... } — normalize to YYYY-MM-DD
  const rawHeatmap = p.heatmap || {};
  const heatmap: Record<string, number> = {};
  for (const [k, v] of Object.entries(rawHeatmap)) {
    const key = stripQuotes(k);
    const normalized = /^\d{8}$/.test(key)
      ? `${key.slice(0, 4)}-${key.slice(4, 6)}-${key.slice(6, 8)}`
      : key;
    heatmap[normalized] = (heatmap[normalized] || 0) + Number(v || 0);
  }

  // AI clients used in this project (Cursor / Trae / Claude Code ...) — for descriptive text only
  const agents: { name: string; count: number }[] = (p.agents || []).map((a: any) => ({
    name: stripQuotes(a.name || a),
    count: Number(a.count || 0),
  }));

  // Model preference — only count real model names on assistant / model / ai replies.
  // User message metadata may carry a model id, but it reflects the active session
  // rather than which model actually generated a response, so it is excluded here.
  // Normalize aliases so that the same model reported under different names is
  // counted as one (e.g. kimi-k3-1 is still kimi-k3).
  const MODEL_ALIASES: Record<string, string> = {
    "kimi-k3-1": "kimi-k3",
    "glm-5.2-x": "glm-5.2",
    "claude-3.5-sonnet": "claude-3.5-sonnet",
  };
  function normalizeModelName(name: string): string {
    return MODEL_ALIASES[name] || name;
  }
  const modelCounts: Record<string, number> = {};
  for (const conv of p.conversations || []) {
    for (const m of conv.messages || []) {
      const mn = stripQuotes(m.model);
      if (!mn) continue;
      const roleRaw = stripQuotes(m.role || "").toLowerCase();
      if (roleRaw === "assistant" || roleRaw === "model" || roleRaw === "ai") {
        const key = normalizeModelName(mn);
        modelCounts[key] = (modelCounts[key] || 0) + 1;
      }
    }
  }
  const totalModelCount = Object.values(modelCounts).reduce((s, c) => s + c, 0) || 1;
  const modelPrefs = Object.entries(modelCounts)
    .filter(([, c]) => c > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name, c]) => ({
      label: name,
      value: Math.round((c / totalModelCount) * 100),
    }));

  // Order conversations by their real start time so the timeline reads
  // chronologically (the earliest "why we built this" chat comes first),
  // instead of following disk / file-scan order.
  const orderedConvs = [...(p.conversations || [])].sort(
    (a, b) => convStartTime(a) - convStartTime(b)
  );

  // chat messages from all conversations (tool calls are preserved in storage
  // but hidden from the chat view to keep the timeline readable).
  const chat: ChatMsg[] = [];
  for (const conv of orderedConvs) {
    const messages = conv.messages || [];
    for (const m of messages) {
      const content = stripQuotes(m.content || m.text);
      if (!content) continue;
      const roleRaw = stripQuotes(m.role || "user");
      if (roleRaw === "tool") continue;
      const role = roleRaw === "assistant" || roleRaw === "model" || roleRaw === "ai" ? "you" : roleRaw === "system" ? "system" : "me";
      chat.push({
        role,
        text: content,
        time: getMessageTime(m),
        model: role === "you" ? getModelName(m) : undefined,
      });
    }
  }

  // Take a representative sample for the can texture, but keep full chat for detail page
  const summary = `${conversationCount} 次对话 · ${messageCount} 条消息`;
  const agentNames = agents.map((a) => a.name).join("、") || "智能体";
  // Prefer the project's own summary (built from real conversation intents);
  // fall back to a generated description only when it's missing.
  const description =
    stripQuotes(p.summary) ||
    `「${name}」项目共包含 ${conversationCount} 次对话，${messageCount} 条消息。项目始于：${agentNames}。`;

  // active day from heatmap
  let activeDay = start;
  let maxCount = 0;
  for (const [day, count] of Object.entries(heatmap)) {
    if (count > maxCount) {
      maxCount = count;
      activeDay = day;
    }
  }
  activeDay = activeDay
    ? /^(\d{4})-(\d{2})-(\d{2})$/.test(activeDay)
      ? activeDay
      : `${activeDay.slice(0, 4)}-${activeDay.slice(4, 6)}-${activeDay.slice(6, 8)}`
    : start;

  // duration: use the backend-computed real conversation time (sum of actual
  // message spans across all conversations, idle gaps excluded). Always show in
  // hours — no day conversion. Fall back to a rough message-count estimate only
  // when no timestamps are available.
  const durationStr =
    durationH > 0
      ? `${durationH.toFixed(1)} h`
      : `${Math.max(1, Math.round((messageCount || 1) / 20))} h`;
  const dataStatus = p.anonymized || stats.anonymized || p.privacy === "anonymized" ? "已脱敏" : "已封存";

  return {
    id,
    name,
    nameEn: "",
    dates,
    primary: colorPrimary,
    secondary: colorSecondary,
    folder: stripQuotes(p.folder || ""),
    completedAtMs,
    projectPath: stripQuotes(p.projectPath || ""),
    tools: (() => {
      const genericIds = new Set(["unknown", "imported", "generic", ""]);
      const genericNames = new Set(["导入文件", "imported", "unknown", "generic", ""]);
      const SOURCE_DISPLAY: Record<string, string> = {
        trae: "Trae",
        cursor: "Cursor",
        "claude-code": "Claude Code",
        claude: "Claude Code",
        codex: "Codex",
        gemini: "Gemini",
        openai: "OpenAI",
        cindy: "Cindy",
        workbuddy: "CodeBuddy",
        codebuddy: "CodeBuddy",
        windsurf: "Windsurf",
        vscode: "VS Code",
        "vscode-copilot": "VS Code Copilot",
        qoder: "Qoder",
      };
      const fromAgents = (p.agents || [])
        .map((a: any) => {
          const name = stripQuotes(a?.name || "");
          let id = String(a?.id ?? "").toLowerCase();
          if (genericIds.has(id) && name && !genericNames.has(name.toLowerCase())) {
            id = name.toLowerCase();
          }
          return { id, name };
        })
        .filter((t: { id: string; name: string }) => !!t.name);
      const hasRealAgent = fromAgents.some(
        (t: { id: string; name: string }) =>
          !genericIds.has(t.id) && !genericNames.has(t.name.toLowerCase())
      );
      if (hasRealAgent) return fromAgents;
      // All agents are generic — fall back to conversation source fields
      const sources = new Set<string>();
      for (const conv of p.conversations || []) {
        const src = stripQuotes(conv?.source || "").toLowerCase();
        if (src) sources.add(src);
      }
      const fromSources = Array.from(sources).map((src) => ({
        id: src,
        name: SOURCE_DISPLAY[src] || (src.charAt(0).toUpperCase() + src.slice(1)),
      }));
      return fromSources.length > 0 ? fromSources : fromAgents;
    })(),
    summary,
    description,
    mood: "智能体对话",
    place: agentNames,
    stats: {
      dialogCount: String(conversationCount),
      activeDay: activeDay || "—",
      duration: durationStr,
      dataStatus,
    },
    modelPrefs,
    workLog: {
      title: name,
      duration: durationStr,
      items: [
        { num: "1", title: "数据来源", desc: `采集自 ${agentNames} 的对话记录。` },
        { num: "2", title: "对话规模", desc: `共 ${conversationCount} 次对话，${messageCount} 条消息，时间范围 ${start || "—"} 至 ${end || "—"}。` },
        { num: "3", title: "活跃分布", desc: `最活跃的一天是 ${activeDay || "—"}，已做${dataStatus === "已脱敏" ? "脱敏" : "存档"}处理。` },
      ],
    },
    chat,
    heatmap,
  };
}

function computeStats(capsules: Capsule[]): LiveStats {
  return {
    totalProjects: capsules.length,
    totalConversations: capsules.reduce((s, c) => s + (Number(c.stats?.dialogCount) || 0), 0),
    totalMessages: capsules.reduce((s, c) => s + (c.chat?.length || 0), 0),
  };
}

export function useLiveCapsules(fallback?: Capsule[]): UseCapsulesResult {
  const [capsules, setCapsules] = useState<Capsule[]>(fallback ?? []);
  const [stats, setStats] = useState<LiveStats>(() => computeStats(fallback ?? []));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (typeof window === "undefined") return;
    setLoading(true);
    try {
      if (window.api?.getProjectsData) {
        const res = await window.api.getProjectsData();
        if (res.success && res.data) {
          const projects = res.data.projects || [];
          setCapsules(projects.map(projectToCapsule));
          setStats({
            totalProjects: res.data.totalProjects ?? projects.length,
            totalConversations: res.data.totalConversations ?? 0,
            totalMessages: res.data.totalMessages ?? 0,
          });
          setError(null);
          return;
        }
      }
      const isElectron =
        typeof navigator !== "undefined" && /Electron/i.test(navigator.userAgent);
      if (isElectron) {
        throw new Error("未能连接到 Electron 主进程，请重启应用");
      }
      // No Electron backend (opened as a plain web page): show an empty library
      // instead of bundled demo data. Real projects only load inside the
      // Electron desktop shell, which reads them from disk.
      setCapsules([]);
      setStats({ totalProjects: 0, totalConversations: 0, totalMessages: 0 });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onChange = () => load();
    window.addEventListener("projects-changed", onChange);
    return () => window.removeEventListener("projects-changed", onChange);
  }, [load]);

  return { capsules, stats, loading, error, refresh: load };
}

export function isElectron(): boolean {
  return typeof window !== "undefined" && !!window.api?.isElectron;
}

export async function openProjectsFolder(): Promise<void> {
  if (window.api?.openProjectsFolder) {
    const res = await window.api.openProjectsFolder();
    if (!res.success) throw new Error(res.error || "打开失败");
  }
}

export async function refreshData(): Promise<void> {
  if (window.api?.collectRefresh) {
    const res = await window.api.collectRefresh();
    if (!res.success) throw new Error(res.error || "刷新失败");
  }
}

export async function addRecord(): Promise<void> {
  if (!window.api) throw new Error("不在 Electron 环境中");
  // prefer folder import
  if (window.api.selectFolder) {
    const res = await window.api.selectFolder();
    if (!res.canceled && res.folderPath && window.api.collectImportFolder) {
      const importRes = await window.api.collectImportFolder(res.folderPath);
      if (!importRes.success) throw new Error(importRes.error || "导入失败");
      return;
    }
  }
  if (window.api.selectFiles) {
    const res = await window.api.selectFiles();
    if (!res.canceled && res.filePaths?.[0] && window.api.collectImportFile) {
      const importRes = await window.api.collectImportFile(res.filePaths[0]);
      if (!importRes.success) throw new Error(importRes.error || "导入失败");
      return;
    }
  }
  throw new Error("未选择文件");
}
