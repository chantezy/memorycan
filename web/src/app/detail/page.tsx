"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import ContributionGraph from "@/components/ContributionGraph";
import ProjectFolderButton from "@/components/ProjectFolderButton";
import ToolIcons from "@/components/ToolIcons";
import BackButton from "@/components/BackButton";
import MarkdownMessage from "@/components/MarkdownMessage";
import { projectToCapsule } from "@/lib/electron-data";
import type { Capsule } from "@/lib/data";

function getStoredId(): string {
  try {
    return sessionStorage.getItem("mc-detail-id") || "";
  } catch {
    return "";
  }
}

function getCurrentId(): string {
  if (typeof window === "undefined") return "";
  // Prefer sessionStorage (set by the home page before navigation) — this is
  // the most reliable way to pass the project ID in a static-export SPA where
  // useSearchParams / pushState interception may race with render.
  const stored = getStoredId();
  if (stored) return stored;
  return new URLSearchParams(window.location.search).get("id") || "";
}

// The detail page is a SINGLE static route that resolves the project at runtime
// via the Electron IPC `getProjectDetail`, falling back to the build-time
// generated capsules for the web preview.
export default function DetailPage() {
  const [id, setId] = useState(getCurrentId);

  // Re-sync id from sessionStorage on mount and on popstate (back/forward)
  useEffect(() => {
    const sync = () => setId(getCurrentId());
    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  const [capsule, setCapsule] = useState<Capsule | null>(null);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const abortRef = useRef<(() => void) | null>(null);

  const loadProjectData = useCallback(async (projectId: string) => {
    // Cancel any in-flight request
    if (abortRef.current) abortRef.current();

    // DEBUG: log what ID we actually received
    console.log("[detail] loadProjectData called with id:", projectId, "| sessionStorage:", getStoredId(), "| URL:", new URLSearchParams(window.location.search).get("id"));

    if (!projectId) {
      setMissing(true);
      setLoading(false);
      return;
    }

    setLoading(true);
    setMissing(false);
    let active = true;
    abortRef.current = () => { active = false; };

    try {
      let data: any = null;
      if (typeof window !== "undefined" && window.api?.getProjectDetail) {
        try {
          const res = await window.api.getProjectDetail(projectId);
          console.log("[detail] IPC getProjectDetail result:", { requestedId: projectId, success: res?.success, returnedFolder: res?.folder, returnedName: res?.data?.name, returnedId: res?.data?.id });
          if (res?.success && res.data) data = res.data;
        } catch {
          /* fall through to static fallback */
        }
      }

      if (!data) {
        if (active) {
          setMissing(true);
          setLoading(false);
        }
        return;
      }

      // Raw project.json (from Electron) has `conversations`; a baked Capsule
      // already has `chat`/`description`/`tools`. Normalize accordingly.
      const cap: Capsule =
        data.conversations || data.chat
          ? data.conversations
            ? (projectToCapsule(data) as Capsule)
            : (data as Capsule)
          : (data as Capsule);

      if (active) {
        setCapsule(cap);
        setLoading(false);
      }
    } catch {
      if (active) {
        setMissing(true);
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    loadProjectData(id);
  }, [id, loadProjectData]);

  // Listen for project-changed events (imports, deletes) to auto-refresh
  useEffect(() => {
    const onProjectsChanged = () => {
      const currentId = getCurrentId();
      if (currentId) loadProjectData(currentId);
    };
    window.addEventListener("projects-changed", onProjectsChanged);
    window.addEventListener("project-imported", onProjectsChanged);
    return () => {
      window.removeEventListener("projects-changed", onProjectsChanged);
      window.removeEventListener("project-imported", onProjectsChanged);
    };
  }, [loadProjectData]);

  if (loading) {
    return (
      <main className="relative min-h-screen w-full flex items-center justify-center bg-[#0a0a09] text-white">
        <div className="flex flex-col items-center gap-4">
          <div className="w-8 h-8 rounded-full border-2 border-white/20 border-t-white/80 animate-spin" />
          <p className="text-xs text-white/40 tracking-[0.3em] font-mono uppercase">加载中</p>
        </div>
      </main>
    );
  }

  if (missing || !capsule) {
    return (
      <main className="relative min-h-screen w-full flex items-center justify-center bg-[#0a0a09] text-white">
        <div className="flex flex-col items-center gap-5 text-center px-6">
          <p className="text-lg text-white/80 tracking-wide">未找到该项目</p>
          <p className="text-xs text-white/40 max-w-sm leading-relaxed">
            项目可能已被删除，或记录尚未导入。返回首页查看已收藏的记忆罐头。
          </p>
          <BackButton
            className="app-region-no-drag inline-flex items-center gap-2 px-5 py-3 rounded-full text-xs font-mono tracking-widest uppercase text-black bg-white hover:bg-white/90 transition-colors cursor-pointer"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <path d="M11 6H1M1 6l5-5M1 6l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            返回首页
          </BackButton>
        </div>
      </main>
    );
  }

  const startYear = parseInt(capsule.dates.slice(0, 4), 10) || new Date().getFullYear();
  const parts = capsule.dates.split("|").map((s) => s.trim());
  const rawStart = parts[0] || "";
  const rawEnd = parts[1] || rawStart;
  const fmt = (s: string) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  const rangeLabel = rawEnd && rawEnd !== rawStart ? `${fmt(rawStart)} 至 ${fmt(rawEnd)}` : fmt(rawStart);
  const endYear = rawEnd ? parseInt(rawEnd.slice(0, 4), 10) : startYear;
  const yearList: number[] = [];
  for (let y = startYear; y <= endYear; y++) yearList.push(y);

  const stats = [
    { label: "对话次数", value: capsule.stats.dialogCount },
    { label: "最活跃日", value: capsule.stats.activeDay },
    { label: "项目周期", value: capsule.stats.duration },
    { label: "数据脱敏", value: capsule.stats.dataStatus },
  ];

  return (
    <main
      className="relative min-h-screen w-full overflow-hidden text-white bg-[#0a0a09]"
      style={{
        background: `radial-gradient(ellipse 80% 60% at 20% 35%, ${capsule.primary}18 0%, transparent 70%), radial-gradient(ellipse 60% 30% at 20% 100%, ${capsule.secondary}12 0%, transparent 65%), #0a0a09`,
        animation: "detailIn 0.55s cubic-bezier(0.2,0.7,0.2,1) both",
      }}
    >
      {/* soft color blob behind the right glass panel so the frost shows */}
      <div
        className="pointer-events-none absolute -right-24 top-1/3 w-[42vw] h-[42vw] rounded-full blur-[120px] opacity-30"
        style={{ background: capsule.secondary }}
        aria-hidden="true"
      />

      {/* HUD top bar — no center logo, draggable window region */}
      <header className="app-region-drag absolute top-0 left-0 right-0 z-30 flex items-center justify-between px-6 py-5 md:px-10 lg:px-16">
        <BackButton
          className="app-region-no-drag inline-flex items-center gap-2 px-5 py-3 text-xs font-mono tracking-widest uppercase text-white/80 hover:text-white transition-colors cursor-pointer"
          style={{ transform: "translate(40px, 10px)" }}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path d="M11 6H1M1 6l5-5M1 6l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          Retour
        </BackButton>

        <div className="app-region-no-drag flex items-center" style={{ transform: "translate(-50px, 10px)" }}>
          <ProjectFolderButton projectId={capsule.id} projectPath={capsule.projectPath} />
        </div>
      </header>

      {/* Corner brackets */}
      <div className="pointer-events-none absolute inset-6 md:inset-10 z-20" aria-hidden="true">
        <span className="absolute top-0 left-0 w-4 h-4 border-t border-l border-white/40" />
        <span className="absolute top-0 right-0 w-4 h-4 border-t border-r border-white/40" />
        <span className="absolute bottom-0 left-0 w-4 h-4 border-b border-l border-white/40" />
        <span className="absolute bottom-0 right-0 w-4 h-4 border-b border-r border-white/40" />
      </div>

      <div
        className="relative z-10 min-h-screen grid grid-cols-1 lg:grid-cols-2 items-stretch px-6 md:px-10 lg:px-16 lg:gap-x-6"
        style={{ transform: "translateY(-50px)" }}
      >
        {/* LEFT — project content */}
        <section className="relative flex flex-col pt-28 lg:pt-32 pb-10">
          {/* title — plain, smaller, no english / no italic */}
          <h1 className="mt-4 text-2xl md:text-3xl font-semibold tracking-tight text-white">
            {capsule.name}
          </h1>

          <SummaryEditor
            description={capsule.description}
            projectId={capsule.id}
            onSave={(text) => setCapsule({ ...capsule, description: text })}
          />

          {/* model preference (left) + four stats in a 2×2 grid (right) */}
          <div className="mt-6 flex flex-col lg:flex-row gap-4 max-w-3xl">
            <ModelPrefs
              prefs={capsule.modelPrefs ?? []}
              primary={capsule.primary}
              secondary={capsule.secondary}
              className="lg:flex-1"
            />
            <div className="grid grid-cols-2 gap-3 lg:flex-1">
              {stats.map((s) => (
                <div key={s.label} className="rounded-xl glass-soft px-4 py-3.5">
                  <p className="text-[10px] uppercase tracking-widest text-white/35 font-mono">{s.label}</p>
                  {s.label === "数据脱敏" ? (
                    <p className="mt-1 text-base text-white font-semibold">
                      {s.value === "已脱敏" ? "ON" : "OFF"}
                    </p>
                  ) : (
                    <p className="mt-1 text-base text-white font-semibold">{s.value}</p>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* contribution heatmap with year switcher */}
          <ContributionGraph
            primary={capsule.primary}
            secondary={capsule.secondary}
            startYear={startYear}
            years={yearList}
            range={rangeLabel}
            heatmap={capsule.heatmap}
            className="mt-6 max-w-3xl"
          />
        </section>

        {/* RIGHT — chat history (view only, plain text) */}
        <aside className="relative p-4 md:p-6 lg:pt-32 lg:pb-4 lg:px-0 flex">
          <div className="glass rounded-3xl flex-1 flex flex-col overflow-hidden max-h-[78vh] lg:max-h-[calc(100vh-9rem)]">
            <div className="px-6 py-4 border-b border-white/10 flex items-center gap-2">
              <ToolIcons tools={capsule.tools} />
              <p className="text-xs text-white/70 font-mono tracking-wide">聊天记录</p>
            </div>

            <div className="chat-scroll flex-1 overflow-y-auto px-6 py-4 space-y-3.5">
              {(capsule.chat ?? []).map((m, i) => {
                if (m.role === "system") {
                  return (
                    <div key={i} className="text-center text-[10px] text-white/30 font-mono tracking-wide py-1">
                      {m.text}
                    </div>
                  );
                }
                const isUser = m.role === "me";
                return (
                  <div key={i} className={`flex flex-col ${isUser ? "items-end" : "items-start"}`}>
                    {!isUser && (
                      <div className="flex items-center gap-1.5 mb-1 px-0.5">
                        <span className="text-[10px] font-semibold tracking-wide text-white/50">
                          {m.model || "Auto"}
                        </span>
                        {m.time && <span className="text-[9px] text-white/25 font-mono">{m.time}</span>}
                      </div>
                    )}
                    {isUser ? (
                      <div
                        className="max-w-[90%] px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed text-white/90"
                        style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)" }}
                      >
                        <MarkdownMessage text={m.text} />
                      </div>
                    ) : (
                      <div className="max-w-[90%] text-sm text-white/70 leading-relaxed text-left">
                        <MarkdownMessage text={m.text} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}

function ModelPrefs({
  prefs,
  primary,
  secondary,
  className = "",
}: {
  prefs: { label: string; value: number }[];
  primary: string;
  secondary: string;
  className?: string;
}) {
  const top = (prefs ?? []).slice(0, 3);
  // No model data — show "Auto" as the only entry so the panel never disappears
  const prefsList = top.length === 0 ? [{ label: "Auto", value: 100 }] : top;
  return (
    <div className={`rounded-2xl glass-soft p-5 ${className}`}>
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs text-white/60 font-mono">模型偏好</p>
        <p className="text-[10px] uppercase tracking-widest text-white/30 font-mono">TOP 3</p>
      </div>
      <div className="space-y-3.5">
        {prefsList.map((p) => {
          // A top-3 model can have a share that rounds to 0% — show it as
          // "<1%" with a small visible bar instead of a misleading "0%".
          const display = p.value === 0 ? "<1%" : `${p.value}%`;
          const widthPct = p.value === 0 ? 3 : p.value;
          return (
            <div key={p.label}>
              <div className="flex items-center justify-between text-xs mb-1.5">
                <span className="text-white/75">{p.label}</span>
                <span className="text-white/40 font-mono">{display}</span>
              </div>
              <div className="h-2 rounded-full bg-white/[0.08] overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${widthPct}%`,
                    background: `linear-gradient(90deg, ${primary}, ${secondary})`,
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// 项目描述编辑：独立子组件，输入框的受控 state 只在自身内部，
// 打字时不会触发整个详情页（贡献图 / 对话列表 / 3D 罐头）重渲染，避免卡顿。
function SummaryEditor({
  description,
  projectId,
  onSave,
}: {
  description: string;
  projectId: string;
  onSave: (text: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(description);
  const [saving, setSaving] = useState(false);

  if (!editing) {
    const isEmpty = !description || description.trim() === "";
    return (
      <div className="mt-5 group relative">
        <div className="flex items-center justify-between mb-2">
          <p className="text-[10px] uppercase tracking-widest text-white/35 font-mono">项目描述</p>
          <button
            onClick={() => {
              setDraft(isEmpty ? "" : description);
              setEditing(true);
            }}
            className="opacity-0 group-hover:opacity-100 transition-opacity text-[10px] text-white/40 hover:text-white/70 font-mono flex items-center gap-1"
            aria-label="编辑项目描述"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
            </svg>
            编辑
          </button>
        </div>
        {isEmpty ? (
          <button
            onClick={() => {
              setDraft("");
              setEditing(true);
            }}
            className="max-w-3xl block text-left text-sm text-white/25 hover:text-white/45 transition-colors"
          >
            + 添加描述
          </button>
        ) : (
          <p
            onClick={() => {
              setDraft(description);
              setEditing(true);
            }}
            className="max-w-3xl text-white/70 text-sm leading-relaxed cursor-pointer hover:text-white/90 transition-colors"
          >
            {description}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="mt-5 space-y-2">
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={4}
        autoFocus
        className="w-full max-w-3xl rounded-xl bg-white/5 border border-white/10 px-3.5 py-3 text-sm text-white/90 leading-relaxed placeholder-white/20 focus:outline-none focus:border-white/30 resize-none"
        placeholder="输入项目描述..."
      />
      <div className="flex items-center gap-2">
        <button
          onClick={async () => {
            if (!window.api?.updateProjectSummary) {
              setEditing(false);
              return;
            }
            setSaving(true);
            try {
              const res = await window.api.updateProjectSummary(projectId, draft);
              if (res.success) {
                onSave(draft);
                setEditing(false);
              } else {
                alert(res.error || "保存失败");
              }
            } finally {
              setSaving(false);
            }
          }}
          disabled={saving}
          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-white text-black hover:bg-white/90 disabled:opacity-50 transition-colors"
        >
          {saving ? "保存中..." : "保存"}
        </button>
        <button
          onClick={() => setEditing(false)}
          className="px-3 py-1.5 rounded-lg text-xs font-medium text-white/70 hover:text-white hover:bg-white/5 transition-colors"
        >
          取消
        </button>
      </div>
    </div>
  );
}
