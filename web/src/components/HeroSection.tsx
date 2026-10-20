"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import ReactDOM from "react-dom";
import { type Capsule } from "@/lib/data";
import { useLiveCapsules, openProjectsFolder, refreshData } from "@/lib/electron-data";
import { playCanSwitch, playCanOpen, playSparklingOpen } from "@/lib/sounds";
import AddRecordModal from "./AddRecordModal";
import { SPACING, type CarouselState } from "./CanCarouselScene";
import LetterGlitch from "./LetterGlitch";
import LightRays from "./LightRays";

const CanCarouselScene = dynamic(() => import("./CanCarouselScene"), { ssr: false });

const VOL_MAX = 0.2;

function formatCapsuleDates(dates: string) {
  if (!dates) return "";
  return dates
    .split("|")
    .map((s) => {
      const t = s.trim();
      // raw yyyymmdd
      if (/^\d{8}$/.test(t)) return `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}`;
      // ISO timestamp like 2026-05-08T13:27:47.869Z or 20260508T13:27:47.869Z
      const iso = t.match(/^(\d{4})-?(\d{2})-?(\d{2})[T ]/);
      if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
      return t;
    })
    .join("｜");
}

// full rainbow spectrum for the bottom color-position bar.
// the marker indicates where the current project's color sits on this fixed spectrum.
const FULL_SPECTRUM = [
  "#ff0000", // red
  "#ff8800", // orange
  "#ffff00", // yellow
  "#00ff00", // green
  "#00ffff", // cyan
  "#0088ff", // azure
  "#0000ff", // blue
  "#8800ff", // violet
  "#ff00ff", // magenta
  "#ff0088", // rose
];

function hexToHue(hex: string) {
  const c = hex.replace("#", "");
  const r = parseInt(c.substring(0, 2), 16) / 255;
  const g = parseInt(c.substring(2, 4), 16) / 255;
  const b = parseInt(c.substring(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return h * 360; // 0..360
}

function lightenHex(hex: string, amount: number) {
  const c = hex.replace("#", "");
  const r = parseInt(c.substring(0, 2), 16);
  const g = parseInt(c.substring(2, 4), 16);
  const b = parseInt(c.substring(4, 6), 16);
  const lr = Math.round(r + (255 - r) * amount);
  const lg = Math.round(g + (255 - g) * amount);
  const lb = Math.round(b + (255 - b) * amount);
  return `rgb(${lr},${lg},${lb})`;
}

export default function HeroSection() {
  const router = useRouter();
  const { capsules, stats, refresh } = useLiveCapsules();
  const slots = capsules.length === 0 ? [null] : [...capsules];

  // --- restore which can was centered before leaving for the detail page ---
  // We remember BOTH the id and the slot index so the home page can land on the
  // same can even while live project data is still loading (Electron).
  const RESTORE_ID = "mc-active-id";
  const RESTORE_IDX = "mc-active-index";
  const readRestore = () => {
    try {
      const id = sessionStorage.getItem(RESTORE_ID);
      const idxRaw = sessionStorage.getItem(RESTORE_IDX);
      const idx = idxRaw != null ? parseInt(idxRaw, 10) : NaN;
      return { id, idx: Number.isFinite(idx) ? idx : -1 };
    } catch {
      return { id: null, idx: -1 };
    }
  };
  const restore0 = readRestore();

  // default to the middle capsule, but honor the saved slot if it still exists
  const initialSlot = (() => {
    if (restore0.idx >= 0 && restore0.idx < slots.length) return restore0.idx;
    if (restore0.id && slots.some((c) => c && c.id === restore0.id)) {
      return slots.findIndex((c) => c && c.id === restore0.id);
    }
    return Math.floor(slots.length / 2);
  })();
  const [activeSlot, setActiveSlot] = useState(initialSlot);
  const [searchOpen, setSearchOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  // Success toast surfaced on the home page after returning from the add modal.
  const [successToast, setSuccessToast] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [soundOn, setSoundOn] = useState(() => {
    if (typeof window === "undefined") return true;
    return localStorage.getItem("memory-can-sound") !== "off";
  });
  const [markerMoving, setMarkerMoving] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const leavingRef = useRef(false);
  const capsule = slots[activeSlot] ?? null; // null = empty placeholder can
  const isEmpty = capsule === null;

  // keep a live ref to slots so the (memoized, stable) can-click handler always
  // resolves the CURRENT capsule instead of a stale closure from first render.
  const slotsRef = useRef(slots);
  useEffect(() => {
    slotsRef.current = slots;
  }, [slots]);

  // keep active slot within bounds when live capsules change
  useEffect(() => {
    if (activeSlot >= slots.length) setActiveSlot(Math.max(0, slots.length - 1));
  }, [activeSlot, slots.length]);

  // --- remember which can is centered so returning from detail lands on it ---
  // This runs whenever the live capsule list changes (including the async load
  // in Electron), so it recovers the slot even if the saved id wasn't present
  // in the initially-rendered (baked) list.
  const didRestore = useRef(false);
  useEffect(() => {
    if (didRestore.current) return;
    const savedId = restore0.id;
    if (!savedId) {
      didRestore.current = true;
      return;
    }
    const idx = capsules.findIndex((c) => c && c.id === savedId);
    if (idx >= 0) {
      setActiveSlot(idx);
      stateRef.current.position = -idx * SPACING;
      stateRef.current.target = -idx * SPACING;
      didRestore.current = true;
    }
    // not found yet (live data still loading) — wait for the next capsules update
  }, [capsules, restore0.id]);

  // continuously persist the centered can (id + slot index) so any navigation
  // away keeps its place and the home page can restore even before data loads
  useEffect(() => {
    const c = slots[activeSlot];
    if (c) {
      try {
        sessionStorage.setItem(RESTORE_ID, c.id);
        sessionStorage.setItem(RESTORE_IDX, String(activeSlot));
      } catch {
        /* ignore */
      }
    }
  }, [activeSlot, slots]);

  // glow colors — neutral gray for empty slots
  const glowPrimary = capsule?.primary ?? "#2a2a2e";
  const glowSecondary = capsule?.secondary ?? "#3a3a40";
  // guard: when there are no capsules at all this index math yields NaN/undefined
  const nextReal =
    capsules.length > 0
      ? capsules[(capsules.indexOf(capsule ?? capsules[0]) + 1) % capsules.length]
      : null;

  const stateRef = useRef<CarouselState>({
    position: -initialSlot * SPACING,
    target: -initialSlot * SPACING,
    holding: false,
    velocity: 0,
    pointerX: 0,
    pointerY: 0,
    lastWheelAt: 0,
  });

  // Pending folder to center on after the next slots update (set by
  // handleImported, consumed once slots actually contain the new project).
  const pendingFolderRef = useRef<string | null>(null);
  useEffect(() => {
    if (!pendingFolderRef.current) return;
    const folder = pendingFolderRef.current;
    const idx = slots.findIndex((c) => c && c.folder === folder);
    if (idx >= 0) {
      pendingFolderRef.current = null;
      setActiveSlot(idx);
      // Sync the 3D carousel position so it actually scrolls to the new can,
      // not just updates the highlighted index.
      stateRef.current.position = -idx * SPACING;
      stateRef.current.target = -idx * SPACING;
      try { sessionStorage.setItem(RESTORE_IDX, String(idx)); } catch {}
    }
  }, [slots]);

  // --- preload heavy 3D assets + prefetch detail pages so navigation is instant ---
  useEffect(() => {
    ReactDOM.preload("/webgl/can.glb", { as: "fetch", crossOrigin: "anonymous" });
    ReactDOM.preload("/webgl/hdri2.hdr", { as: "fetch", crossOrigin: "anonymous" });
    ReactDOM.preload("/webgl/can-metallic.avif", { as: "image" });
    const idle = window.requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 1500));
    idle(() => {
      // The detail page is a single static route that reads ?id= at runtime,
      // so there is no per-project HTML to prefetch — just warm the route chunk.
      router.prefetch(`/detail/`);
      // preload the detail 3D scene chunk so navigating to a flavor feels instant
      import("@/components/SingleCanScene");
    });
  }, [router, capsules]);

  // --- synthesized ambient instrumental music ---
  const audioRef = useRef<{
    ctx: AudioContext;
    master: GainNode;
    timer: ReturnType<typeof setTimeout> | null;
    chordTimer: ReturnType<typeof setInterval> | null;
  } | null>(null);
  const gestureRef = useRef<(() => void) | null>(null);

  const stopSound = useCallback(() => {
    if (gestureRef.current) {
      window.removeEventListener("pointerdown", gestureRef.current, true);
      window.removeEventListener("keydown", gestureRef.current, true);
      window.removeEventListener("touchstart", gestureRef.current, true);
      gestureRef.current = null;
    }
    if (audioRef.current) {
      if (audioRef.current.timer) clearTimeout(audioRef.current.timer);
      if (audioRef.current.chordTimer) clearInterval(audioRef.current.chordTimer);
      audioRef.current.ctx.close().catch(() => {});
      audioRef.current = null;
    }
  }, []);

  // schedule the actual notes — only call while the context is already running
  const startMusicLoop = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    const { ctx, master } = a;

    const delay = ctx.createDelay(1.0);
    delay.delayTime.value = 0.45;
    const fb = ctx.createGain();
    fb.gain.value = 0.32;
    const wet = ctx.createGain();
    wet.gain.value = 0.45;
    delay.connect(fb);
    fb.connect(delay);
    delay.connect(wet);
    wet.connect(master);

    const chords = [
      [130.81, 164.81, 196.0, 246.94], // Cmaj7
      [110.0, 146.83, 174.61, 220.0],   // Am7
      [130.81, 174.61, 220.0, 261.63],  // Fmaj7
      [98.0, 146.83, 196.0, 246.94],    // Gmaj7
    ];
    let chordIdx = 0;
    let padVoices: { osc: OscillatorNode; gain: GainNode }[] = [];
    const setChord = (idx: number) => {
      const now = ctx.currentTime;
      padVoices.forEach((v) => {
        v.gain.gain.cancelScheduledValues(now);
        v.gain.gain.setValueAtTime(v.gain.gain.value, now);
        v.gain.gain.linearRampToValueAtTime(0.0001, now + 2.0);
        v.osc.stop(now + 2.2);
      });
      padVoices = chords[idx].map((f) => {
        const osc = ctx.createOscillator();
        osc.type = "triangle";
        osc.frequency.value = f;
        osc.detune.value = (Math.random() - 0.5) * 6;
        const gain = ctx.createGain();
        gain.gain.value = 0.0;
        gain.gain.linearRampToValueAtTime(0.07, now + 1.8);
        osc.connect(gain);
        gain.connect(master);
        gain.connect(delay);
        osc.start(now);
        return { osc, gain };
      });
    };
    setChord(0);
    a.chordTimer = setInterval(() => {
      chordIdx = (chordIdx + 1) % chords.length;
      setChord(chordIdx);
    }, 6200);

    const scale = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33];
    const melody = () => {
      if (!audioRef.current) return;
      const now = ctx.currentTime;
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.value = scale[Math.floor(Math.random() * scale.length)];
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(0.08, now + 0.08);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 2.2);
      o.connect(g);
      g.connect(master);
      g.connect(delay);
      o.start(now);
      o.stop(now + 2.4);
      a.timer = setTimeout(melody, 760 + Math.random() * 900);
    };
    melody();
  }, []);

  // create / resume the audio context and start the loop on the first gesture
  const ensureAudio = useCallback(() => {
    if (!audioRef.current) {
      const ctx = new AudioContext();
      const master = ctx.createGain();
      master.gain.value = VOL_MAX * 0.65;
      master.connect(ctx.destination);
      audioRef.current = { ctx, master, timer: null, chordTimer: null };
    }
    const a = audioRef.current;
    const begin = () => {
      if (a.timer !== null || a.chordTimer !== null) return; // already playing
      startMusicLoop();
    };
    if (a.ctx.state === "running") {
      begin();
    } else {
      a.ctx.resume().then(begin).catch(() => {});
      // capture-phase listeners fire before any child stopPropagation, so the
      // very first tap / drag / key resumes audio and starts the music instantly
      const onGesture = () => {
        a.ctx.resume().then(begin).catch(() => {});
        window.removeEventListener("pointerdown", onGesture, true);
        window.removeEventListener("keydown", onGesture, true);
        window.removeEventListener("touchstart", onGesture, true);
        gestureRef.current = null;
      };
      gestureRef.current = onGesture;
      window.addEventListener("pointerdown", onGesture, true);
      window.addEventListener("keydown", onGesture, true);
      window.addEventListener("touchstart", onGesture, true);
    }
  }, [startMusicLoop]);

  useEffect(() => {
    if (soundOn) ensureAudio();
    else stopSound();
    return () => stopSound();
  }, [soundOn, ensureAudio, stopSound]);

  // --- dedicated UI sound context (independent of ambient toggle) ---
  const uiAudioRef = useRef<AudioContext | null>(null);
  const getUiCtx = useCallback(() => {
    if (!uiAudioRef.current || uiAudioRef.current.state === "closed") {
      uiAudioRef.current = new AudioContext();
    }
    if (uiAudioRef.current.state === "suspended") uiAudioRef.current.resume().catch(() => {});
    return uiAudioRef.current;
  }, []);
  useEffect(() => () => {
    uiAudioRef.current?.close().catch(() => {});
  }, []);

  const toggleSound = useCallback(() => {
    const turningOn = !soundOn;
    setSoundOn((on) => {
      const next = !on;
      localStorage.setItem("memory-can-sound", next ? "on" : "off");
      return next;
    });
    // we are inside the click gesture, so resume() is allowed and music starts at once
    if (turningOn) ensureAudio();
  }, [soundOn, ensureAudio]);

  // --- can switch sound + liquid marker pulse ---
  const prevSlotRef = useRef(activeSlot);
  const moveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (prevSlotRef.current === activeSlot) return;
    prevSlotRef.current = activeSlot;

    // trigger liquid squash
    setMarkerMoving(true);
    if (moveTimeout.current) clearTimeout(moveTimeout.current);
    moveTimeout.current = setTimeout(() => setMarkerMoving(false), 600);

    // play switch sound only when audio is enabled
    if (!soundOn) return;
    const ctx = getUiCtx();
    playCanSwitch(ctx);
  }, [activeSlot, getUiCtx, soundOn]);

  useEffect(() => () => {
    if (moveTimeout.current) clearTimeout(moveTimeout.current);
  }, []);

  const openDetail = useCallback(
    (c: Capsule) => {
      if (leavingRef.current || !c) return;
      console.log("[home] openDetail called for:", c.id, c.name, "| activeSlot:", activeSlot, "| leaving:", leavingRef.current);
      // remember the can we opened so the home page returns to it (not the default)
      const slotIdx = slotsRef.current.findIndex((x) => x && x.id === c.id);
      try {
        sessionStorage.setItem(RESTORE_ID, c.id);
        sessionStorage.setItem(RESTORE_IDX, String(slotIdx >= 0 ? slotIdx : activeSlot));
      } catch {
        /* ignore */
      }
      leavingRef.current = true;
      // can-lid opening sound first, then the sparkling soda fizz (300ms later)
      if (soundOn) {
        const ctx = new AudioContext();
        ctx.resume().catch(() => {});
        playCanOpen(ctx);
        setTimeout(() => playSparklingOpen(ctx), 300);
        setTimeout(() => ctx.close().catch(() => {}), 1800);
      }
      // camera push into the center can, then navigate
      setLeaving(true);
      try {
        sessionStorage.setItem("mc-detail-id", c.id);
        console.log("[home] set mc-detail-id to:", c.id);
      } catch {
        /* ignore */
      }
      window.setTimeout(() => router.push(`/detail/?id=${encodeURIComponent(c.id)}`), 580);
    },
    [router, soundOn, activeSlot]
  );

  // --- Electron toolbar actions ---
  const handleImported = useCallback(async (projectFolder?: string) => {
    try {
      if (projectFolder) pendingFolderRef.current = projectFolder;
      await refreshData();
      await refresh();
      // The pending-folder useEffect (above) will pick up the new slot once
      // `slots` actually contains the imported project and center on it.
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("刷新数据失败:", e);
    }
  }, [refresh]);

  const handleOpenFolder = useCallback(async () => {
    try {
      await openProjectsFolder();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("打开文件夹失败:", e);
    }
  }, []);

  const handleRefresh = useCallback(async () => {
    try {
      await refreshData();
      await refresh();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("刷新失败:", e);
    }
  }, [refresh]);

  const dragging = useRef(false);
  const dragStart = useRef({ x: 0, target: 0 });
  const lastMove = useRef({ x: 0, t: 0 });

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (slotsRef.current.length <= 1) return; // empty / single can: no drag-switching
    dragging.current = true;
    stateRef.current.holding = true;
    stateRef.current.velocity = 0;
    dragStart.current = { x: e.clientX, target: stateRef.current.target };
    lastMove.current = { x: e.clientX, t: performance.now() };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    // parallax target (always tracked)
    stateRef.current.pointerX = (e.clientX / window.innerWidth) * 2 - 1;
    stateRef.current.pointerY = (e.clientY / window.innerHeight) * 2 - 1;

    if (!dragging.current) return;
    const dx = e.clientX - dragStart.current.x;
    // cans follow the finger: drag left → cans move left → next comes in from the right
    stateRef.current.target = dragStart.current.target + dx * 0.011;
    lastMove.current = { x: e.clientX, t: performance.now() };
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    dragging.current = false;
    stateRef.current.holding = false;
    // flick momentum
    const dt = Math.max(performance.now() - lastMove.current.t, 1);
    if (dt < 120) {
      const vx = (e.clientX - lastMove.current.x) / dt; // px per ms
      stateRef.current.velocity = vx * 0.011 * 16;
    }
  }, []);

  const onWheel = useCallback((e: React.WheelEvent) => {
    if (slotsRef.current.length <= 1) return; // empty / single can: no wheel switching
    // precise steps: move the target directly, snap engages after scrolling stops
    const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    const s = stateRef.current;
    s.velocity = 0;
    s.target -= delta * 0.0035;
    s.lastWheelAt = performance.now();
  }, []);

  const goTo = useCallback((dir: 1 | -1) => {
    if (slotsRef.current.length <= 1) return; // single / empty can — no switching
    const s = stateRef.current;
    s.velocity = 0;
    s.target = (Math.round(s.target / SPACING) - dir) * SPACING;
  }, []);

  const handleIndexChange = useCallback((slotIndex: number) => setActiveSlot(slotIndex), []);

  // keep openDetail fresh too, so the stable click handler never calls a stale version
  const openDetailRef = useRef(openDetail);
  useEffect(() => {
    openDetailRef.current = openDetail;
  }, [openDetail]);

  const handleCanClick = useCallback((slotIndex: number) => {
    const c = slotsRef.current[slotIndex];
    console.log("[home] handleCanClick slotIndex:", slotIndex, "| slotsRef.length:", slotsRef.current.length, "| found:", c?.id, c?.name);
    if (!c) return; // empty can — not clickable
    openDetailRef.current(c);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSearchOpen(false);
      if (searchOpen) return;
      if (e.key === "ArrowRight") goTo(1);
      if (e.key === "ArrowLeft") goTo(-1);
      if (e.key === "Enter" && capsule) openDetail(capsule);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goTo, capsule, searchOpen, openDetail]);

  // fixed full-rainbow spectrum bar; marker shows where the current flavor's color sits
  const rainbow = `linear-gradient(90deg, ${FULL_SPECTRUM.join(", ")})`;
  const markerLeft = capsule
    ? `${Math.max(2, Math.min(98, (hexToHue(capsule.secondary) / 360) * 100))}%`
    : "0%";

  return (
    <>
    <section
      id="gamme"
      className="relative h-screen w-full overflow-hidden select-none touch-none cursor-default"
      style={{
        "--glow-color": glowSecondary,
        transform: leaving ? "scale(2.2)" : "scale(1)",
        opacity: leaving ? 0 : 1,
        transition: "transform 0.62s cubic-bezier(0.55,0,0.45,1), opacity 0.58s ease-in",
        transformOrigin: "center center",
        pointerEvents: leaving ? "none" : "auto",
      } as React.CSSProperties}
      onPointerDown={searchOpen ? undefined : onPointerDown}
      onPointerMove={searchOpen ? undefined : onPointerMove}
      onPointerUp={searchOpen ? undefined : onPointerUp}
      onPointerCancel={searchOpen ? undefined : onPointerUp}
      onWheel={searchOpen ? undefined : onWheel}
    >
      {/* letter glitch background (deepest layer, black-ish tones) */}
      <div className="absolute inset-0 z-0">
        <LetterGlitch />
      </div>

      {/* top light rays */}
      <LightRays />

      {/* Background glow that follows flavor */}
      <div
        className="absolute inset-0 z-[1] transition-all duration-1000"
        style={{
          background: `radial-gradient(ellipse 90% 70% at 50% 55%, ${glowPrimary}40 0%, ${glowPrimary}18 35%, transparent 70%), radial-gradient(ellipse 80% 45% at 50% 115%, ${glowPrimary}55 0%, transparent 60%), rgba(10,10,9,0.72)`,
        }}
        aria-hidden="true"
      />

      {/* AI breathing glow behind the center can */}
      <div className="absolute inset-0 z-[2] flex items-center justify-center pointer-events-none" aria-hidden="true">
        <div
          className="ai-glow"
          style={{
            background: `radial-gradient(ellipse at 32% 38%, ${glowSecondary}59, transparent 62%), radial-gradient(ellipse at 68% 62%, ${glowPrimary}73, transparent 66%), radial-gradient(ellipse at 50% 50%, ${(nextReal?.secondary ?? "#2a2a2e")}40, transparent 60%)`,
          }}
        />
      </div>

      {/* bottom rainbow aurora (like the original site's floor glow) */}
      <div className="absolute inset-x-0 bottom-0 h-[50%] z-[3] pointer-events-none" aria-hidden="true">
        <div
          className="absolute inset-0"
          style={{
            background: rainbow,
            filter: "blur(100px)",
            opacity: 0.42,
            maskImage: "linear-gradient(to top, black 25%, transparent 92%)",
            WebkitMaskImage: "linear-gradient(to top, black 25%, transparent 92%)",
          }}
        />
      </div>

      {/* 3D scene */}
      <div className="absolute inset-0 z-10">
        <CanCarouselScene
          capsules={capsules}
          stateRef={stateRef}
          onIndexChange={handleIndexChange}
          onCanClick={handleCanClick}
        />
      </div>

      {/* HUD: top bar — draggable window region for frameless Electron */}
      <header
        className="app-region-drag absolute top-0 left-0 right-0 z-30 flex items-center justify-between px-6 py-6 md:py-7 md:px-10"
        onPointerDown={(e) => e.stopPropagation()}
        style={{ minHeight: 88 }}
      >
        {/* app logo — top-left */}
        <div
          className="app-region-no-drag"
          style={{ transform: "translate(30px, 10px)" }}
        >
          <img
            src="/app-icon.png"
            alt="记忆罐头"
            className="w-9 h-9 rounded-md object-cover"
            style={{ border: "1px solid rgba(255,255,255,0.12)" }}
          />
        </div>

        {/* center brand title — large, special Franklin Gothic Black Italic font */}
        <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-center">
          <span
            className="text-xl md:text-2xl lg:text-3xl tracking-wide text-white"
            style={{ fontFamily: "var(--font-franklin)" }}
          >
            Memory Can
          </span>
        </div>

        {/* action buttons */}
        <div
          className="app-region-no-drag flex items-center gap-2 md:gap-3"
          style={{ transform: "translate(-30px, 10px)" }}
        >
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            onPointerDown={(e) => e.stopPropagation()}
            className="px-3 md:px-4 py-1.5 rounded-full bg-[#1a1a1d] text-white/90 text-[10px] md:text-xs font-medium tracking-wider border border-white/10 hover:bg-[#222225] hover:text-white transition-colors"
          >
            搜索
          </button>
          <button
            type="button"
            onClick={handleOpenFolder}
            onPointerDown={(e) => e.stopPropagation()}
            className="px-3 md:px-4 py-1.5 rounded-full bg-[#1a1a1d] text-white/90 text-[10px] md:text-xs font-medium tracking-wider border border-white/10 hover:bg-[#222225] hover:text-white transition-colors"
          >
            项目
          </button>
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            onPointerDown={(e) => e.stopPropagation()}
            className="px-3 md:px-4 py-1.5 rounded-full bg-[#c97b4f] text-white text-[10px] md:text-xs font-medium tracking-wider hover:bg-[#b86a40] transition-colors flex items-center gap-1"
          >
            <span className="text-xs leading-none">+</span>
            <span>添加</span>
          </button>
        </div>
      </header>

      {/* Corner brackets */}
      <div className="pointer-events-none absolute inset-6 md:inset-10 z-20" aria-hidden="true">
        <span className="absolute top-0 left-0 w-4 h-4 border-t border-l border-white/40" />
        <span className="absolute top-0 right-0 w-4 h-4 border-t border-r border-white/40" />
        <span className="absolute bottom-0 left-0 w-4 h-4 border-b border-l border-white/40" />
        <span className="absolute bottom-0 right-0 w-4 h-4 border-b border-r border-white/40" />
      </div>

      {/* Switch arrows flanking the center can — hidden when there's only one (or empty) can */}
      {(slots.length > 1) && (<>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          goTo(-1);
        }}
        onPointerDown={(e) => e.stopPropagation()}
        className="absolute left-1/2 top-1/2 z-30 p-4 text-white/70 hover:text-white hover:scale-110 transition-all"
        style={{ transform: "translate(calc(-50% - 125px), -50%)" }}
        aria-label="Précédent"
      >
        <DottedArrow className="rotate-180" />
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          goTo(1);
        }}
        onPointerDown={(e) => e.stopPropagation()}
        className="absolute left-1/2 top-1/2 z-30 p-4 text-white/70 hover:text-white hover:scale-110 transition-all"
        style={{ transform: "translate(calc(-50% + 125px), -50%)" }}
        aria-label="Suivant"
      >
        <DottedArrow />
      </button>
      </>)}

      {/* capsule name + shortened rainbow bar with liquid marker */}
      <div className="absolute bottom-0 left-0 right-0 z-30 pointer-events-none pb-6 md:pb-8">
        <button
          type="button"
          key={capsule?.id ?? "empty"}
          disabled={!capsule}
          onClick={(e) => {
            e.stopPropagation();
            if (capsule) openDetail(capsule);
          }}
          onPointerDown={(e) => e.stopPropagation()}
          className="pointer-events-auto block mx-auto text-center text-xl md:text-2xl font-normal tracking-wide text-white h-7 md:h-8 hover:opacity-80 transition-opacity disabled:hover:opacity-100 disabled:cursor-default max-w-[min(640px,82vw)] truncate"
          style={{ cursor: capsule ? "pointer" : "default" }}
          title={capsule?.name ?? ""}
        >
          {capsule?.name ?? ""}
        </button>

        <div className="mt-5 md:mt-6 mx-auto w-[min(228px,37vw)]">
          <div className="relative h-6">
            <svg className="absolute w-0 h-0" aria-hidden="true">
              <defs>
                <filter id="progress-gooey" x="-50%" y="-50%" width="200%" height="200%">
                  <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur" />
                  <feColorMatrix
                    in="blur"
                    mode="matrix"
                    values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 19 -8"
                    result="goo"
                  />
                  <feBlend in="SourceGraphic" in2="goo" />
                </filter>
              </defs>
            </svg>
            <div
              className="absolute inset-0 pointer-events-none"
              style={{ filter: "url(#progress-gooey)" }}
              aria-hidden="true"
            >
              <div
                className="absolute top-1/2 left-0 right-0 h-[3px] -translate-y-1/2 rounded-full opacity-100"
                style={{ background: rainbow }}
              />
            </div>
            {/* marker — clean circle outside the gooey filter, stretches while moving */}
            {capsule && (
              <span
                className={`liquid-marker ${markerMoving ? "is-moving" : ""}`}
                style={{
                  left: markerLeft,
                  background: `radial-gradient(circle at 35% 35%, ${lightenHex(capsule.secondary, 0.55)} 0%, ${capsule.secondary} 72%)`,
                  boxShadow: `0 0 10px ${capsule.secondary}88`,
                }}
              />
            )}
          </div>
        </div>

        {isEmpty ? (
          <p className="mt-4 text-center text-xs text-white/55 leading-relaxed tracking-[0.05em]">
            点击右上角「+ 添加」→ 复制提示词给 AI → 导出对话后拖入文件夹，<br />
            即可生成你的第一个记忆罐头
          </p>
        ) : (
          <p className="mt-4 text-center text-[10px] uppercase tracking-[0.3em] text-white/40 font-mono">
            Scroll to explore
          </p>
        )}
      </div>

      {/* sound toggle — bottom right */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          toggleSound();
        }}
        onPointerDown={(e) => e.stopPropagation()}
        className="absolute bottom-6 right-[calc(1.5rem+50px)] md:bottom-8 md:right-[calc(2rem+50px)] z-30 pointer-events-auto flex items-center gap-2 text-white/80 hover:text-white transition-colors"
        aria-label={soundOn ? "静音" : "播放声音"}
      >
        {soundOn ? <EqIcon /> : <MuteIcon />}
        <span className="text-[10px] uppercase tracking-widest font-mono">
          {soundOn ? "on" : "off"}
        </span>
      </button>

      {/* search overlay */}
      {searchOpen && (
        <div
          className="fixed inset-0 z-[70] bg-black/80 backdrop-blur-md flex items-start justify-center pt-[18vh] px-6"
          onClick={() => setSearchOpen(false)}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div
            className="w-full max-w-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索项目名称…"
              className="w-full bg-transparent border-b border-white/25 focus:border-white/60 outline-none text-white text-2xl md:text-3xl font-light py-4 placeholder:text-white/25 tracking-wide"
            />
            <ul className="chat-scroll mt-4 max-h-[50vh] overflow-y-auto divide-y divide-white/8">
              {capsules
                // sort the search list by project completion time (newest completion first)
                .slice()
                .sort((a, b) => (b.completedAtMs ?? 0) - (a.completedAtMs ?? 0))
                .map((c, i) => ({ c, i }))
                .filter(({ c }) =>
                  query.trim() === ""
                    ? true
                    : c.name.includes(query.trim()) ||
                      c.nameEn.toLowerCase().includes(query.trim().toLowerCase())
                )
                .map(({ c, i }) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setSearchOpen(false);
                        openDetail(c);
                      }}
                      className="w-full flex items-center gap-4 py-4 text-left group"
                    >
                      <span
                        className="w-3 h-3 rounded-full flex-shrink-0"
                        style={{ background: c.secondary, boxShadow: `0 0 8px ${c.secondary}88` }}
                      />
                      <span className="flex-1 min-w-0 truncate text-white/85 group-hover:text-white text-lg tracking-wide transition-colors">
                        {c.name}
                      </span>
                      <span className="text-white/35 text-xs font-mono ml-auto whitespace-nowrap flex-shrink-0">{formatCapsuleDates(c.dates)}</span>
                    </button>
                  </li>
                ))}
              {capsules.filter(
                (c) =>
                  query.trim() !== "" &&
                  !c.name.includes(query.trim()) &&
                  !c.nameEn.toLowerCase().includes(query.trim().toLowerCase())
              ).length === capsules.length && (
                <li className="py-6 text-white/35 text-sm text-center">没有找到相关项目</li>
              )}
            </ul>
            <p className="mt-4 text-[10px] uppercase tracking-[0.3em] text-white/30 font-mono text-center">
              ESC 关闭
            </p>
          </div>
        </div>
      )}

      {/* live stats — project color dots + totals */}
      <div
        className="app-region-no-drag absolute bottom-6 left-6 z-30 pointer-events-none select-none"
        style={{ transform: "translate(60px, -10px)" }}
      >
        <div className="font-mono text-[10px] md:text-xs tracking-wide text-white/50">
          <span>{stats.totalProjects} 个罐头</span>
          <span className="mx-2 text-white/30">·</span>
          <span>{stats.totalConversations} 次对话</span>
          <span className="mx-2 text-white/30">·</span>
          <span>{stats.totalMessages} 条消息</span>
        </div>
      </div>

      </section>

      {/* add-record modal */}
      <AddRecordModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onImported={handleImported}
        onAdded={(message) => {
          setSuccessToast(message);
          window.setTimeout(() => setSuccessToast(null), 2600);
        }}
      />

      {/* success toast — shown on the home page after a record is added */}
      {successToast && (
        <div
          className="fixed top-6 left-1/2 -translate-x-1/2 z-[90] px-5 py-2.5 rounded-full text-sm font-medium text-white shadow-lg pointer-events-none"
          style={{ background: "rgba(95,184,168,0.92)", border: "1px solid rgba(255,255,255,0.15)" }}
        >
          {successToast}
        </div>
      )}
    </>
  );
}

function EqIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <rect
          key={i}
          x={2 + i * 6}
          y="2"
          width="3.5"
          height="16"
          rx="1.75"
          fill="currentColor"
          className="eq-bar"
          style={{ animationDelay: `${i * 0.12}s`, transformOrigin: "center" }}
        />
      ))}
    </svg>
  );
}

function MuteIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" />
      <path d="M16 9l5 5M21 9l-5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

/** dotted arrow like the original site's carousel nav */
function DottedArrow({ className = "" }: { className?: string }) {
  return (
    <svg
      width="18"
      height="34"
      viewBox="0 0 17 32"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M13.9822 13.4458C12.8142 13.4458 11.8673 14.3927 11.8673 15.5607C11.8673 16.7287 12.8142 17.6756 13.9822 17.6756C15.1503 17.6756 16.0971 16.7287 16.0971 15.5607C16.0971 14.3927 15.1503 13.4458 13.9822 13.4458Z"
        fill="currentColor"
      />
      <path
        d="M8.04863 6.77686C6.8806 6.77686 5.93372 7.72373 5.93372 8.89177C5.93372 10.0598 6.8806 11.0067 8.04863 11.0067C9.21666 11.0067 10.1635 10.0598 10.1635 8.89177C10.1635 7.72373 9.21666 6.77686 8.04863 6.77686Z"
        fill="currentColor"
        fillOpacity="0.6"
      />
      <path
        d="M8.04863 20.1143C6.8806 20.1143 5.93372 21.0611 5.93372 22.2292C5.93372 23.3972 6.8806 24.3441 8.04863 24.3441C9.21666 24.3441 10.1635 23.3972 10.1635 22.2292C10.1635 21.0611 9.21666 20.1143 8.04863 20.1143Z"
        fill="currentColor"
        fillOpacity="0.6"
      />
      <path
        d="M2.11491 26.8911C0.946879 26.8911 0 27.838 0 29.006C0 30.1741 0.946879 31.1209 2.11491 31.1209C3.28295 31.1209 4.22983 30.1741 4.22983 29.006C4.22983 27.838 3.28295 26.8911 2.11491 26.8911Z"
        fill="currentColor"
        fillOpacity="0.3"
      />
      <rect
        width="4.22982"
        height="4.22983"
        rx="2.11491"
        transform="matrix(0 1 1 -4.37114e-08 0 7.03622e-07)"
        fill="currentColor"
        fillOpacity="0.3"
      />
    </svg>
  );
}
