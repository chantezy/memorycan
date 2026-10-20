"use client";

import { useState } from "react";

function seededRand(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

function buildCells(year: number, primary: string, secondary: string) {
  const rand = seededRand(year * 2654435761);
  const weeks = 53;
  const days = 7;
  const cells: { key: string; alpha: number; color: string; date?: string; count: number }[] = [];
  for (let w = 0; w < weeks; w++) {
    for (let d = 0; d < days; d++) {
      const r = rand();
      const level = r < 0.45 ? 0 : r < 0.7 ? 1 : r < 0.88 ? 2 : 3;
      const base = level === 0 ? "#1a1a1a" : rand() > 0.5 ? primary : secondary;
      cells.push({ key: `${w}-${d}`, alpha: [0, 0.3, 0.6, 0.95][level], color: base, date: undefined, count: 0 });
    }
  }
  return cells;
}

// Build real GitHub-style cells from the project's date→count heatmap.
function buildCellsFromHeatmap(
  year: number,
  heatmap: Record<string, number>,
  primary: string,
  secondary: string,
  maxCount: number
) {
  const weeks = 53;
  const days = 7;
  // first Sunday on/before Jan 1 of the year
  const jan1 = new Date(year, 0, 1);
  const start = new Date(year, 0, 1 - jan1.getDay());
  const fmt = (dt: Date) => {
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, "0");
    const d = String(dt.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  };
  const cells: { key: string; alpha: number; color: string; date?: string; count: number }[] = [];
  for (let w = 0; w < weeks; w++) {
    for (let d = 0; d < days; d++) {
      const dt = new Date(start);
      dt.setDate(start.getDate() + w * 7 + d);
      if (dt.getFullYear() !== year) {
        cells.push({ key: `${w}-${d}`, alpha: 0, color: "transparent", date: undefined, count: 0 });
        continue;
      }
      const key = fmt(dt);
      const count = heatmap[key] ?? 0;
      if (count === 0) {
        cells.push({ key, alpha: 0, color: "#1a1a1a", date: key, count: 0 });
      } else {
        const ratio = count / maxCount;
        const level = ratio <= 0.25 ? 1 : ratio <= 0.6 ? 2 : 3;
        // Use a single color ramp: intensity is encoded ONLY by alpha.
        // (Previously the cell hue alternated by grid position, which made
        //  a higher-count cell look lighter than a lower-count one.)
        const color = primary;
        cells.push({ key, alpha: [0, 0.35, 0.65, 0.95][level], color, date: key, count });
      }
    }
  }
  return cells;
}

const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatDateCN(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  return `${y}年${m}月${d}日`;
}

export default function ContributionGraph({
  primary,
  secondary,
  startYear,
  years,
  range,
  heatmap,
  className = "",
}: {
  primary: string;
  secondary: string;
  startYear?: number;
  years?: number[];
  range?: string;
  heatmap?: Record<string, number>;
  className?: string;
}) {
  const yearList = years && years.length > 0 ? years : [2023, 2024, 2025];
  const [year, setYear] = useState(startYear && yearList.includes(startYear) ? startYear : yearList[0]);
  const [tip, setTip] = useState<{ date: string; count: number } | null>(null);
  const [tipPos, setTipPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  const hasHeatmap = !!heatmap && Object.keys(heatmap).length > 0;
  const maxCount = hasHeatmap ? Math.max(1, ...Object.values(heatmap!)) : 1;
  const cells = hasHeatmap
    ? buildCellsFromHeatmap(year, heatmap!, primary, secondary, maxCount)
    : buildCells(year, primary, secondary);

  return (
    <div className={`rounded-2xl glass-soft p-5 ${className}`}>
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs text-white/60 font-mono">{range ?? `${year} 年 · 活跃度`}</p>
        <p className="text-[10px] uppercase tracking-widest text-white/30 font-mono">活跃度</p>
      </div>

      <div className="flex justify-between px-[2px] mb-2 text-[10px] text-white/30 font-mono tracking-wide">
        {months.map((m) => (
          <span key={m}>{m}</span>
        ))}
      </div>
      <div className="overflow-x-auto pb-1 -mx-1 px-1">
        <div
          className="grid gap-[3px] min-w-[360px]"
          style={{ gridTemplateColumns: `repeat(53, minmax(6px, 1fr))` }}
          onMouseMove={(e) => setTipPos({ x: e.clientX, y: e.clientY })}
          onMouseLeave={() => setTip(null)}
        >
          {cells.map((c) => (
            <div
              key={c.key}
              className="aspect-square rounded-[2px]"
              style={{ background: c.color, opacity: c.alpha === 0 ? (c.color === "transparent" ? 0 : 1) : c.alpha }}
              onMouseEnter={() => setTip(c.date && c.count > 0 ? { date: c.date, count: c.count } : null)}
            />
          ))}
        </div>
      </div>

      {tip && (
        <div
          className="pointer-events-none fixed z-[80] px-2.5 py-1.5 rounded-lg text-[11px] font-mono shadow-lg whitespace-nowrap"
          style={{
            left: tipPos.x,
            top: tipPos.y,
            transform: "translate(8px, 8px)",
            background: "rgba(18,18,20,0.96)",
            border: "1px solid rgba(255,255,255,0.14)",
            color: "#fff",
          }}
        >
          {formatDateCN(tip.date)}
          <span className="text-white/55">
            {tip.count > 0 ? ` · ${tip.count} 条消息` : " · 无记录"}
          </span>
        </div>
      )}

      <div className="mt-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        {/* year switcher — bottom left */}
        <div className="flex flex-wrap items-center gap-1">
          {yearList.map((y) => (
            <button
              key={y}
              type="button"
              onClick={() => setYear(y)}
              className={`px-2.5 py-1 rounded-md text-[11px] font-mono transition-colors ${
                y === year
                  ? "bg-white/15 text-white"
                  : "text-white/40 hover:text-white/70 hover:bg-white/[0.06]"
              }`}
            >
              {y}
            </button>
          ))}
        </div>

        {/* legend — bottom right */}
        <div className="flex items-center gap-1.5 text-[10px] text-white/30 font-mono shrink-0">
          <span>Less</span>
          <span className="w-2.5 h-2.5 rounded-[2px] bg-[#1a1a1a]" />
          <span className="w-2.5 h-2.5 rounded-[2px]" style={{ background: primary, opacity: 0.35 }} />
          <span className="w-2.5 h-2.5 rounded-[2px]" style={{ background: primary, opacity: 0.65 }} />
          <span className="w-2.5 h-2.5 rounded-[2px]" style={{ background: primary, opacity: 0.95 }} />
          <span>More</span>
        </div>
      </div>
    </div>
  );
}
