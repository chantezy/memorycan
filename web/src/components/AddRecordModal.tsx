"use client";

import { useEffect, useRef, useState } from "react";

interface SourceInfo {
  id: string;
  name: string;
  icon: string;
  sourceId?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onImported: (projectFolder?: string) => void;
  /** Fired with a success message so the home page can surface it after the modal closes. */
  onAdded?: (message: string) => void;
}

const AGENT_TOOLS: SourceInfo[] = [
  { id: "cursor", name: "Cursor", icon: "/icons/cursor.png", sourceId: "cursor" },
  { id: "trae", name: "Trae", icon: "/icons/trae.png", sourceId: "trae" },
  { id: "claude-code", name: "Claude Code", icon: "/icons/claude.png", sourceId: "claude-code" },
  { id: "claude-desktop", name: "Claude", icon: "/icons/claude.png", sourceId: "claude-desktop" },
  { id: "codex", name: "Codex CLI", icon: "/icons/codex.png", sourceId: "codex" },
  { id: "codex-desktop", name: "Codex", icon: "/icons/codex.png", sourceId: "codex-desktop" },
  { id: "gemini", name: "Gemini", icon: "/icons/gemini.png" },
  { id: "codebuddy", name: "CodeBuddy", icon: "/icons/codebuddy.webp", sourceId: "codebuddy" },
  { id: "windsurf", name: "Windsurf", icon: "/icons/windsurf.png", sourceId: "windsurf" },
  { id: "qoder", name: "Qoder", icon: "/icons/qoder.png", sourceId: "qoder" },
  { id: "cindy", name: "Cindy", icon: "/icons/cindy.png", sourceId: "cindy" },
];

const FALLBACK_PROMPT = `请把当前这个对话所属的项目相关的 AI 对话记录，整理成「记忆罐头」可识别的标准格式。

1. 先确认要整理哪个项目——默认就是当前这个对话所属的项目（根据我们的上下文推断项目名/路径），确认后再读取。
2. 如果你是云端智能体（如 CodeBuddy、网页版 ChatGPT），本机没有记录文件，直接从当前对话上下文提取全部历史消息整理。
3. 收集该项目全部对话原文，保留 Markdown/代码块/换行，不要摘要或截断。
4. 在桌面创建「<项目名>-export-YYYYMMDD」文件夹，导出为多个 .json 文件（含 role、content、timestamp、model）。model 字段仅用于 AI 回复（assistant/tool），人类消息（user）不要包含 model；如无法确定模型名，填 "Auto"。
5. 导出前不要自动脱敏：先列出敏感信息清单并询问我是否需要脱敏，按我回答处理。
6. 找不到记录时，引导我直接把记录文件发给你，由你按标准格式整理导出。
7. 不要上传/发送/删除任何文件，只在本地创建导出文件夹。`;

interface ConvGroup {
  key: string;
  label: string;
  fullPath: string;
  agentName: string;
  conversationCount: number;
  lastModified: string;
}

export default function AddRecordModal({ open, onClose, onImported, onAdded }: Props) {
  const [mode, setMode] = useState<"agents" | "folder">("folder");
  const [detected, setDetected] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useState<string[]>([]);
  const [picked, setPicked] = useState<string | null>(null);
  const [anonymize, setAnonymize] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingText, setLoadingText] = useState("导入中…");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);
  const [promptContent, setPromptContent] = useState<string>(FALLBACK_PROMPT);
  const [promptLoading, setPromptLoading] = useState(false);
  const initialRef = useRef(false);

  // Scan preview step: after selecting agents, the user sees conversation
  // groups (by project folder) and picks which ones to import as separate
  // projects instead of everything getting mashed into one.
  const [scanStep, setScanStep] = useState<"select" | "groups">("select");
  const [groups, setGroups] = useState<ConvGroup[]>([]);
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (open && !initialRef.current) {
      initialRef.current = true;
      // detect installed agents
      if (window.api?.detectSources) {
        window.api
          .detectSources()
          .then((res) => {
            if (res.success && res.sources) {
              const map: Record<string, boolean> = {};
              for (const s of res.sources) map[s.id] = s.exists;
              setDetected(map);
            }
          })
          .catch(() => {});
      }
      // load the collection prompt from project root
      if (window.api?.getCollectionPrompt) {
        setPromptLoading(true);
        window.api
          .getCollectionPrompt()
          .then((res) => {
            if (res.success && res.content) setPromptContent(res.content);
          })
          .catch(() => {})
          .finally(() => setPromptLoading(false));
      }
    }
  }, [open]);

  // The main process recovers the real filesystem path of a folder dropped
  // anywhere on the window (the renderer can't read OS drag paths directly)
  // and forwards it here. When it arrives we switch to folder mode and fill in
  // the picked folder, no matter where inside the modal the drop happened.
  useEffect(() => {
    const onNativeDrop = (e: Event) => {
      const detail = (e as CustomEvent<{ folderPath?: string }>).detail;
      if (detail?.folderPath) {
        setMode("folder");
        setPicked(detail.folderPath);
        setError(null);
        setDragActive(false);
      }
    };
    window.addEventListener("app:native-drop", onNativeDrop as EventListener);
    return () =>
      window.removeEventListener("app:native-drop", onNativeDrop as EventListener);
  }, []);

  // Accept an OS file/folder dropped onto the modal. The real path recovery
  // happens in the preload script (Electron's `webUtils.getPathForFile`), which
  // forwards the resolved folder via `app:native-drop` (handled above). Here we
  // only mark this as a valid drop target so the browser doesn't navigate, and
  // clear the drag highlight. The renderer cannot read OS drag paths itself
  // (Electron 32+ removed `File.path`), so we intentionally do NOT read
  // e.dataTransfer here.
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
  };

  const reset = () => {
    setMode("agents");
    setSelected([]);
    setPicked(null);
    setAnonymize(false);
    setError(null);
    setLoading(false);
    setCopied(false);
    setDragActive(false);
    setConfirmOverwrite(false);
    setScanStep("select");
    setGroups([]);
    setSelectedGroups(new Set());
  };

  const toggleTool = (tool: SourceInfo) => {
    if (tool.sourceId && !detected[tool.sourceId]) return;
    setSelected((prev) =>
      prev.includes(tool.id) ? prev.filter((x) => x !== tool.id) : [...prev, tool.id]
    );
  };

  const handlePickFolder = async () => {
    setError(null);
    const api = window.api;
    if (!api?.selectFolder) return;
    const res = await api.selectFolder();
    if (res.canceled || !res.folderPath) return;
    setPicked(res.folderPath);
  };

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(promptContent || FALLBACK_PROMPT);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard may be unavailable */
    }
  };

  // Trigger a preview scan: scan selected agents and show conversation groups
  // so the user can pick which projects to import separately.
  const handlePreviewScan = async () => {
    setError(null);
    if (selected.length === 0) {
      setError("请选择至少一个已安装的智能体");
      return;
    }
    const sourceIds = selected
      .map((id) => AGENT_TOOLS.find((t) => t.id === id)?.sourceId)
      .filter(Boolean) as string[];
    if (sourceIds.length === 0) {
      setError("所选智能体暂不支持直接扫描");
      return;
    }
    setLoading(true);
    setLoadingText("扫描对话记录中…");
    try {
      const api = window.api;
      if (!api?.previewScan) throw new Error("缺少扫描接口");
      const res = await api.previewScan({ sourceIds });
      if (!res.success) throw new Error(res.error || "扫描失败");
      if (!res.groups || res.groups.length === 0) throw new Error("未找到对话记录");
      setGroups(res.groups);
      // Pre-select all groups by default — the user can deselect ones they don't want.
      setSelectedGroups(new Set(res.groups.map((g) => g.key)));
      setScanStep("groups");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const toggleGroup = (key: string) => {
    setSelectedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const runImport = async (opts?: { overwrite?: boolean }) => {
    setError(null);
    setLoading(true);
    setLoadingText("导入中…");
    try {
      const api = window.api;
      if (!api) throw new Error("请在记忆罐头应用内使用此功能");

      let res: {
        success: boolean;
        error?: string;
        projectFolder?: string;
        projectCount?: number;
        alreadyExists?: boolean;
      } | undefined;

      if (mode === "agents") {
        if (selected.length === 0) throw new Error("请选择至少一个已安装的智能体");
        const sourceIds = selected
          .map((id) => AGENT_TOOLS.find((t) => t.id === id)?.sourceId)
          .filter(Boolean) as string[];
        if (sourceIds.length === 0) throw new Error("所选智能体暂不支持直接扫描");
        if (!api.importToProject) throw new Error("缺少导入接口");

        // If we're in the groups step, pass the selected group keys so the
        // backend creates one project per group.
        const groupKeys = scanStep === "groups" ? Array.from(selectedGroups) : undefined;
        if (scanStep === "groups" && (!groupKeys || groupKeys.length === 0)) {
          throw new Error("请至少选择一个项目分组");
        }
        const projectName = `${selected
          .map((id) => AGENT_TOOLS.find((t) => t.id === id)?.name || id)
          .join("_")}_${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`;
        res = await api.importToProject({
          sourceType: "scan",
          sourceIds,
          projectName,
          selectedGroups: groupKeys,
          overwrite: !!opts?.overwrite,
        });
      } else {
        if (!picked) {
          await handlePickFolder();
          setLoading(false);
          return;
        }
        const projectName = picked.split(/[\\/]/).pop() || "imported_project";
        if (!api.importToProject) throw new Error("缺少导入接口");
        res = await api.importToProject({ sourceType: "folder", folderPath: picked, projectName, overwrite: !!opts?.overwrite });
      }

      if (!res?.success) throw new Error(res?.error || "导入失败");

      // Project already exists — ask the user whether to overwrite it instead
      // of silently skipping.
      if ((res as { alreadyExists?: boolean }).alreadyExists) {
        setLoading(false);
        setConfirmOverwrite(true);
        return;
      }

      if (anonymize && res.projectFolder && api.anonymizeProject) {
        setLoadingText("脱敏处理中…");
        const anonRes = await api.anonymizeProject(res.projectFolder);
        if (!anonRes.success) throw new Error(anonRes.error || "脱敏失败");
      }

      const count = res.projectCount || 1;
      setLoading(false);
      // Hand the success message to the home page so it shows there after we
      // return, then close the modal right away.
      onAdded?.(`已添加 ${count} 个记忆罐头`);
      reset();
      onImported(res.projectFolder);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setLoading(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center px-4"
      style={{
        background: "rgba(5,4,7,0.55)",
        backdropFilter: "blur(20px) saturate(140%)",
        WebkitBackdropFilter: "blur(20px) saturate(140%)",
      }}
      onClick={onClose}
      onDragOver={(e) => {
        e.preventDefault();
        if (!dragActive) setDragActive(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setDragActive(false);
      }}
      onDrop={handleDrop}
    >
      <div
        className="w-full max-w-[720px] max-h-[92vh] overflow-hidden rounded-3xl flex flex-col"
        style={{
          height: 660,
          background: "rgba(20,18,26,0.65)",
          backdropFilter: "blur(40px) saturate(160%)",
          WebkitBackdropFilter: "blur(40px) saturate(160%)",
          border: "1px solid rgba(255,255,255,0.08)",
          boxShadow:
            "0 24px 80px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04), inset 0 1px 0 rgba(255,255,255,0.06)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div
          className="flex items-center justify-between px-7 pt-6 pb-4 flex-shrink-0"
          style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}
        >
          <h2 className="text-white text-xl font-medium tracking-wide">添加项目记忆</h2>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-white/50 hover:text-white hover:bg-white/10 transition-colors text-sm"
            style={{ border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.04)" }}
          >
            ✕
          </button>
        </div>

        <div className="px-7 py-6 flex-1 flex flex-col min-h-0">
          {/* tabs */}
          <div
            className="flex p-1 rounded-2xl mb-5 flex-shrink-0"
            style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}
          >
            <button
              type="button"
              onClick={() => {
                setMode("agents");
                setError(null);
                setScanStep("select");
              }}
              className="flex-1 py-2.5 rounded-xl text-sm font-medium transition-all"
              style={{
                background: mode === "agents" ? "rgba(201,123,79,0.12)" : "transparent",
                color: mode === "agents" ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.45)",
                border: mode === "agents" ? "1px solid rgba(201,123,79,0.25)" : "1px solid transparent",
              }}
            >
              扫描本地智能体
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("folder");
                setError(null);
                setScanStep("select");
              }}
              className="flex-1 py-2.5 rounded-xl text-sm font-medium transition-all"
              style={{
                background: mode === "folder" ? "rgba(201,123,79,0.12)" : "transparent",
                color: mode === "folder" ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.45)",
                border: mode === "folder" ? "1px solid rgba(201,123,79,0.25)" : "1px solid transparent",
              }}
            >
              导入文件夹
            </button>
          </div>

          {/* content area: fixed flex height so switching tabs never resizes the modal */}
          <div className="flex-1 flex flex-col overflow-hidden min-h-0">
            {mode === "agents" ? (
              scanStep === "groups" ? (
                <div className="flex flex-col flex-1 min-h-0">
                  <div className="flex items-center justify-between mb-4 flex-shrink-0">
                    <div>
                      <p className="text-xs text-white/40">
                        扫描到 {groups.length} 个项目分组，共 {groups.reduce((s, g) => s + g.conversationCount, 0)} 条对话
                      </p>
                      <p className="text-[11px] text-white/30 mt-1">选择要导入的项目，每个项目将独立保存</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setScanStep("select");
                        setGroups([]);
                        setSelectedGroups(new Set());
                        setError(null);
                      }}
                      className="text-xs text-white/50 hover:text-white transition-colors px-3 py-1 rounded-full"
                      style={{ border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.03)" }}
                    >
                      ← 返回重选
                    </button>
                  </div>
                  <div className="overflow-y-auto no-scrollbar space-y-2 pr-1" style={{ flex: 1, minHeight: 0 }}>
                    {groups.map((g) => {
                      const checked = selectedGroups.has(g.key);
                      return (
                        <button
                          key={g.key}
                          type="button"
                          onClick={() => toggleGroup(g.key)}
                          className="w-full flex items-center gap-3 rounded-2xl px-4 py-3 text-left transition-all"
                          style={{
                            border: checked
                              ? "1px solid rgba(201,123,79,0.4)"
                              : "1px solid rgba(255,255,255,0.07)",
                            background: checked
                              ? "rgba(201,123,79,0.08)"
                              : "rgba(255,255,255,0.03)",
                          }}
                        >
                          <div
                            className="flex-shrink-0 w-5 h-5 rounded-md flex items-center justify-center"
                            style={{
                              border: checked
                                ? "1px solid #c97b4f"
                                : "1px solid rgba(255,255,255,0.2)",
                              background: checked ? "#c97b4f" : "transparent",
                            }}
                          >
                            {checked && (
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                                <path d="M5 12l5 5L20 7" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-white/85 font-medium truncate">{g.label}</p>
                            {g.fullPath && (
                              <p className="text-[11px] text-white/35 truncate mt-0.5">{g.fullPath}</p>
                            )}
                          </div>
                          <div className="flex-shrink-0 text-right">
                            <p className="text-xs text-white/60">{g.conversationCount} 条对话</p>
                            {g.lastModified && (
                              <p className="text-[10px] text-white/30 mt-0.5">
                                {g.lastModified.slice(0, 10)}
                              </p>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col flex-1 min-h-0">
                  <p className="text-xs text-white/40 mb-4">选择已安装的智能体，扫描后可按项目分别导入</p>
                  <div className="grid grid-cols-4 gap-3">
                    {AGENT_TOOLS.map((tool) => {
                      const installed = !!tool.sourceId && !!detected[tool.sourceId];
                      const checked = selected.includes(tool.id);
                      return (
                        <button
                          key={tool.id}
                          type="button"
                          onClick={() => toggleTool(tool)}
                          disabled={!installed}
                          className="relative flex flex-col items-center justify-center gap-2 rounded-2xl p-3 text-center transition-all"
                          style={{
                            border: checked
                              ? "1px solid rgba(201,123,79,0.4)"
                              : "1px solid rgba(255,255,255,0.07)",
                            background: checked
                              ? "rgba(201,123,79,0.08)"
                              : installed
                              ? "rgba(255,255,255,0.03)"
                              : "rgba(255,255,255,0.015)",
                            opacity: installed ? 1 : 0.4,
                          }}
                        >
                          <img
                            src={tool.icon}
                            alt={tool.name}
                            className="w-9 h-9 object-cover rounded-md"
                            style={{ border: "1px solid rgba(255,255,255,0.1)" }}
                          />
                          <span className="text-[11px] text-white/80 leading-tight">{tool.name}</span>
                          {!installed && (
                            <span className="text-[9px] text-white/30">未安装</span>
                          )}
                          {checked && installed && (
                            <span
                              className="absolute top-2 right-2 w-2 h-2 rounded-full"
                              style={{ background: "#c97b4f" }}
                            />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )
            ) : (
              <div
                className="flex flex-col flex-1 min-h-0"
                onDragEnter={(e) => {
                  e.preventDefault();
                  if (!dragActive) setDragActive(true);
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (!dragActive) setDragActive(true);
                }}
                onDragLeave={(e) => {
                  if (e.currentTarget.contains(e.relatedTarget as Node)) return;
                  setDragActive(false);
                }}
                onDrop={handleDrop}
              >
                <ul className="space-y-0">
                  <li className="flex items-center gap-3 py-2.5 text-xs text-white/45" style={{ lineHeight: 1.7 }}>
                    <span
                      className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-semibold"
                      style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.5)" }}
                    >
                      1
                    </span>
                    <span>复制给智能体的数据收集指令</span>
                    <button
                      type="button"
                      onClick={copyPrompt}
                      disabled={copied}
                      className="px-3 py-1 rounded-full text-[11px] font-medium transition-opacity flex-shrink-0"
                      style={{ background: "#c97b4f", color: "#fff", opacity: copied ? 0.8 : 1 }}
                    >
                      {copied ? "已复制" : "复制"}
                    </button>
                  </li>
                  {[
                    "粘贴到你想导出的项目对话中（Cursor、Trae、CodeBuddy 等），AI 会自动整理记录",
                    "智能体引导你确认项目、查找记录、导出到桌面文件夹",
                    "回到这里，点击下方选择导出的文件夹",
                  ].map((t, i) => (
                    <li
                      key={i}
                      className="flex gap-3 py-2.5 text-xs text-white/45"
                      style={{ lineHeight: 1.7 }}
                    >
                      <span
                        className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-semibold"
                        style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.5)" }}
                      >
                        {i + 2}
                      </span>
                      <span>{t}</span>
                    </li>
                  ))}
                </ul>

                {picked ? (
                  <div
                    className="mt-3 w-full rounded-2xl px-4 py-4 flex items-center gap-3.5 transition-all cursor-pointer group"
                    style={{
                      background: "rgba(255,255,255,0.04)",
                      border: "1px solid rgba(255,255,255,0.10)",
                    }}
                    onClick={handlePickFolder}
                    title="点击可重新选择文件夹"
                  >
                    <div
                      className="flex-shrink-0 w-12 h-12 rounded-xl flex items-center justify-center"
                      style={{ background: "rgba(201,123,79,0.12)" }}
                    >
                      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <path
                          d="M22 8.5V17C22 18.6569 20.6569 20 19 20H5C3.34315 20 2 18.6569 2 17V7C2 5.34315 3.34315 4 5 4H9.5L11.5 7H19C20.6569 7 22 7.5 22 8.5Z"
                          fill="rgba(201,123,79,0.25)"
                          stroke="#c97b4f"
                          strokeWidth="1.5"
                        />
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-white/80 font-medium truncate">
                        {picked.split(/[\\/]/).pop() || picked}
                      </p>
                      <p className="text-[11px] text-white/35 truncate mt-0.5">{picked}</p>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setPicked(null);
                        setError(null);
                      }}
                      className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-white/45 hover:text-white hover:bg-white/10 transition-colors"
                      style={{ border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.03)" }}
                      title="移除"
                    >
                      ✕
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={handlePickFolder}
                    onDragEnter={(e) => {
                      e.preventDefault();
                      if (!dragActive) setDragActive(true);
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      if (!dragActive) setDragActive(true);
                    }}
                    onDragLeave={(e) => {
                      if (e.currentTarget.contains(e.relatedTarget as Node)) return;
                      setDragActive(false);
                    }}
                    onDrop={handleDrop}
                    className="mt-3 w-full rounded-2xl py-10 text-center transition-all"
                    style={{
                      border: dragActive
                        ? "2px dashed rgba(201,123,79,0.7)"
                        : "2px dashed rgba(255,255,255,0.12)",
                      background: dragActive
                        ? "rgba(201,123,79,0.10)"
                        : "rgba(255,255,255,0.02)",
                    }}
                  >
                    <div className="flex justify-center mb-2">
                      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <path
                          d="M22 8.5V17C22 18.6569 20.6569 20 19 20H5C3.34315 20 2 18.6569 2 17V7C2 5.34315 3.34315 4 5 4H9.5L11.5 7H19C20.6569 7 22 7.5 22 8.5Z"
                          fill={dragActive ? "rgba(201,123,79,0.15)" : "rgba(255,255,255,0.08)"}
                          stroke={dragActive ? "rgba(201,123,79,0.7)" : "rgba(255,255,255,0.25)"}
                          strokeWidth="1.5"
                        />
                        <path
                          d={dragActive ? "M12 16V11M12 11L9.5 13.5M12 11L14.5 13.5" : "M12 11V16M12 16L9.5 13.5M12 16L14.5 13.5"}
                          stroke="#c97b4f"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </div>
                    <div className="text-sm text-white/70">
                      {dragActive ? "松手即可导入该文件夹" : "选择或拖入智能体导出的文件夹"}
                    </div>
                    <div className="text-[11px] text-white/35 mt-1">
                      点击选择，或把文件夹拖到这里
                    </div>
                  </button>
                )}
              </div>
            )}
          </div>

          {/* bottom options: checkbox left (scan tab only), buttons right, vertically centered */}
          <div
            className="mt-5 pt-4 flex-shrink-0 flex items-center gap-3"
            style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}
          >
            {mode === "agents" && (
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={anonymize}
                  onChange={(e) => setAnonymize(e.target.checked)}
                  className="accent-[#c97b4f] w-4 h-4"
                />
                <span className="text-xs text-white/70">导入后自动运行脱敏脚本处理项目文件</span>
              </label>
            )}

            <div className="ml-auto flex flex-col items-end gap-2">
              {error && <p className="text-[#e07a5f] text-xs">{error}</p>}

              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-5 py-2 rounded-full text-white/70 text-sm hover:text-white transition-colors"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={() => (mode === "agents" && scanStep === "select" ? handlePreviewScan() : runImport())}
                  disabled={loading || (mode === "agents" && scanStep === "groups" && selectedGroups.size === 0)}
                  className="px-5 py-2 rounded-full text-white text-sm transition-colors disabled:opacity-50"
                  style={{ background: "#c97b4f" }}
                >
                  {loading
                    ? loadingText
                    : mode === "agents" && scanStep === "select"
                    ? "扫描对话记录"
                    : mode === "agents" && scanStep === "groups"
                    ? `确认导入 (${selectedGroups.size})`
                    : "确认导入"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* confirm overwrite — project with the same name already exists */}
      {confirmOverwrite && (
        <div
          className="absolute inset-0 z-[90] flex items-center justify-center px-4"
          style={{ background: "rgba(5,4,7,0.6)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)" }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setConfirmOverwrite(false);
          }}
        >
          <div
            className="w-full max-w-[400px] rounded-2xl p-6 flex flex-col"
            style={{
              background: "rgba(28,25,34,0.92)",
              border: "1px solid rgba(255,255,255,0.1)",
              boxShadow: "0 24px 80px rgba(0,0,0,0.6)",
            }}
          >
            <h3 className="text-white text-base font-medium tracking-wide">项目已存在</h3>
            <p className="mt-3 text-sm text-white/65 leading-relaxed">
              该名称的记忆罐头已添加。是否覆盖已有记录？覆盖后将用本次导入的数据替换原内容，且不可恢复。
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setConfirmOverwrite(false)}
                className="px-5 py-2 rounded-full text-white/70 text-sm hover:text-white transition-colors"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => runImport({ overwrite: true })}
                disabled={loading}
                className="px-5 py-2 rounded-full text-white text-sm transition-colors disabled:opacity-50"
                style={{ background: "#c97b4f" }}
              >
                {loading ? "导入中…" : "覆盖导入"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
