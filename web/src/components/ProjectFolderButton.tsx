"use client";

import { useEffect, useState } from "react";

/**
 * Top-right folder button on the detail page.
 *
 * Behavior (Electron runtime):
 *  - When a valid projectPath exists and the folder is present → "打开文件夹"
 *  - When no path has been captured (or the saved one is gone) →
 *    "关联文件夹" / "重新关联文件夹": opens a folder picker and persists the
 *    choice into projects/<folder>/project.json via associateProjectFolder.
 *
 * In web/preview mode (no window.api) it falls back to the build-time
 * projectPath and hides itself when empty (legacy behavior).
 */
export default function ProjectFolderButton({
  projectId,
  projectPath,
}: {
  projectId?: string;
  projectPath?: string;
}) {
  const [path, setPath] = useState<string>(projectPath && projectPath.trim() ? projectPath.trim() : "");
  const [exists, setExists] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  // Determined after mount so the first (hydrating) render matches the server
  // output (which has no window) and avoids a React #418 hydration mismatch
  // in the Electron runtime where window.api exists on the client only.
  const [isElectron, setIsElectron] = useState(false);

  useEffect(() => {
    setIsElectron(typeof window !== "undefined" && !!window.api);
  }, []);

  // Fetch the live projectPath at runtime (the build-time value may be stale).
  useEffect(() => {
    let active = true;
    if (typeof window === "undefined" || !window.api?.getProjectDetail || !projectId) {
      // web fallback: use build-time path only
      const p = projectPath && projectPath.trim() ? projectPath.trim() : "";
      setPath(p);
      return;
    }
    window.api
      .getProjectDetail(projectId)
      .then((res) => {
        if (!active) return;
        const live = res?.data?.projectPath;
        setPath(live && String(live).trim() ? String(live).trim() : "");
      })
      .catch(() => {
        if (active) setPath(projectPath && projectPath.trim() ? projectPath.trim() : "");
      });
    return () => {
      active = false;
    };
  }, [projectId, projectPath]);

  // Check whether the resolved folder exists.
  useEffect(() => {
    let active = true;
    if (!path) {
      setExists(false);
      return;
    }
    if (window.api?.projectFolderExists) {
      window.api
        .projectFolderExists(path)
        .then((res) => {
          if (active) setExists(res?.exists ?? false);
        })
        .catch(() => {
          if (active) setExists(false);
        });
    } else {
      setExists(false);
    }
    return () => {
      active = false;
    };
  }, [path]);

  const handleAssociate = async () => {
    if (busy || !window.api?.selectFolder || !window.api?.associateProjectFolder || !projectId) return;
    setBusy(true);
    try {
      const res = await window.api.selectFolder();
      if (res.canceled || !res.folderPath) return;
      const save = await window.api.associateProjectFolder(projectId, res.folderPath);
      if (!save?.success) {
        console.error("关联文件夹失败:", save?.error);
        return;
      }
      setPath(res.folderPath);
    } catch (e) {
      console.error("关联文件夹异常:", e);
    } finally {
      setBusy(false);
    }
  };

  const handleOpen = async () => {
    try {
      await window.api?.openProjectFolder?.(path);
    } catch {
      /* folder may have been removed between check and click */
    }
  };

  // In web/preview mode there is no local filesystem, so keep the legacy
  // behavior: only show the button when an openable folder is present.
  if (!isElectron && exists !== true) return null;

  const label = !path ? "关联文件夹" : exists === true ? "打开文件夹" : "重新关联文件夹";

  return (
    <button
      type="button"
      onClick={path && exists === true ? handleOpen : handleAssociate}
      onPointerDown={(e) => e.stopPropagation()}
      disabled={busy}
      className="app-region-no-drag rounded-full bg-white text-black px-5 py-2 text-xs font-medium tracking-widest uppercase cursor-pointer hover:bg-white/90 transition-colors disabled:opacity-50"
    >
      {label}
    </button>
  );
}
