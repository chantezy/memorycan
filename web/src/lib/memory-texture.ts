"use client";

import * as THREE from "three";
import { useEffect, useState } from "react";
import type { Capsule } from "./data";

const FONT_URL = "/fonts/6a0b3ae273b9c591afba279f_Franklin_Gothic_ATF_Black_Italic.woff2";
let fontReady: Promise<void> | null = null;

function ensureFont() {
  if (!fontReady) {
    fontReady = (async () => {
      try {
        const face = new FontFace("FranklinATF", `url(${FONT_URL})`, {
          weight: "900",
          style: "italic",
        });
        await face.load();
        document.fonts.add(face);
      } catch {
        // fallback fonts will be used
      }
    })();
  }
  return fontReady;
}

function fontFamily() {
  return document.fonts.check("900 italic 100px FranklinATF")
    ? 'FranklinATF, "Arial Black", sans-serif'
    : '"Arial Black", "Helvetica Neue", sans-serif';
}

// App icon (memory-can logo) drawn on the can front face. Loaded once and
// cached; the texture is (re)built after it loads.
let appIconImage: HTMLImageElement | null = null;
let appIconPromise: Promise<void> | null = null;
function ensureAppIcon() {
  if (appIconImage) return Promise.resolve();
  if (!appIconPromise) {
    appIconPromise = new Promise<void>((resolve) => {
      try {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
          appIconImage = img;
          resolve();
        };
        img.onerror = () => resolve();
        img.src = "/app-icon.png";
      } catch {
        resolve();
      }
    });
  }
  return appIconPromise;
}

function shade(hex: string, amount: number) {
  const c = new THREE.Color(hex);
  c.offsetHSL(0, 0, amount);
  return `#${c.getHexString()}`;
}

/**
 * Can label texture: flavor-colored label, pink capsule icon, vertical "MEMORY",
 * vertical 项目名, "CAPSULE" + date range at bottom, 项目摘要 strip on the side.
 * Canvas x → U (around the can), canvas y → V (can height, top = 0).
 */
export function createMemoryTexture(capsule: Capsule | null): THREE.CanvasTexture {
  const w = 1024;
  const h = 1600;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;

  // empty placeholder can — plain dark gray label, no text
  if (!capsule) {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "#6a6a70");
    g.addColorStop(0.5, "#4c4c52");
    g.addColorStop(1, "#36363b");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    const sv = ctx.createLinearGradient(0, 0, w, 0);
    sv.addColorStop(0, "rgba(0,0,0,0.5)");
    sv.addColorStop(0.2, "rgba(0,0,0,0)");
    sv.addColorStop(0.8, "rgba(0,0,0,0)");
    sv.addColorStop(1, "rgba(0,0,0,0.5)");
    ctx.fillStyle = sv;
    ctx.fillRect(0, 0, w, h);

    // empty placeholder can — plain dark label, no text
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  const { primary, secondary } = capsule;

  // --- base: flavor color gradient (top brighter → bottom deeper) ---
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, shade(primary, 0.10));
  grad.addColorStop(0.4, primary);
  grad.addColorStop(0.8, shade(primary, -0.06));
  grad.addColorStop(1, shade(primary, -0.14));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // secondary hue sweep for a richer, multi-tone look
  const sweep = ctx.createLinearGradient(0, 0, w, h);
  sweep.addColorStop(0, `${secondary}00`);
  sweep.addColorStop(0.5, `${secondary}30`);
  sweep.addColorStop(1, `${secondary}55`);
  ctx.fillStyle = sweep;
  ctx.fillRect(0, 0, w, h);

  // horizontal vignette so the wrap edges stay dark
  const side = ctx.createLinearGradient(0, 0, w, 0);
  side.addColorStop(0, "rgba(0,0,0,0.5)");
  side.addColorStop(0.2, "rgba(0,0,0,0)");
  side.addColorStop(0.8, "rgba(0,0,0,0)");
  side.addColorStop(1, "rgba(0,0,0,0.5)");
  ctx.fillStyle = side;
  ctx.fillRect(0, 0, w, h);

  const cx = w / 2;

  // --- 项目摘要 strip (left side, vertical lines) ---
  ctx.save();
  ctx.translate(w * 0.075, 0);
  ctx.rotate(Math.PI / 2);
  ctx.font = `300 34px ${fontFamily()}`;
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  for (let i = 0; i < 13; i++) {
    ctx.fillText(capsule.summary, i * 123 + 40, 0);
  }
  ctx.restore();

  // --- app icon (memory-can logo) on the front face, replacing the old glyph.
  //     Moved to the same left column as the project name (cx - 100). ---
  const iconX = cx - 100;
  const iconY = h * 0.08;
  const iconR = 48;
  if (appIconImage) {
    ctx.save();
    ctx.translate(iconX, iconY);
    ctx.rotate(-0.1);
    ctx.beginPath();
    ctx.roundRect(-iconR, -iconR, iconR * 2, iconR * 2, 22);
    ctx.clip();
    ctx.drawImage(appIconImage, -iconR, -iconR, iconR * 2, iconR * 2);
    ctx.restore();
    // subtle rounded border so it reads as a badge on the label
    ctx.save();
    ctx.translate(iconX, iconY);
    ctx.rotate(-0.1);
    ctx.beginPath();
    ctx.roundRect(-iconR, -iconR, iconR * 2, iconR * 2, 22);
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(255,255,255,0.28)";
    ctx.stroke();
    ctx.restore();
  }

  // --- 项目名 (rotated vertical, 90° rotation; sits in the same left column as
  //     the app icon. Starts just below the icon and extends downward so it
  //     never overlaps the icon regardless of name length.) ---
  ctx.save();
  ctx.translate(cx - 100, h * 0.14);
  ctx.rotate(Math.PI / 2);
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const maxName = 18;
  const nameArr = Array.from(capsule.name);
  const nameStr = nameArr.length > maxName ? nameArr.slice(0, maxName).join("") + "…" : capsule.name;
  const nameFont = Math.min(100, Math.floor(1180 / nameStr.length));
  ctx.font = `700 ${nameFont}px "PingFang SC", "Microsoft YaHei", sans-serif`;
  ctx.fillStyle = "rgba(255,255,255,0.97)";
  ctx.fillText(nameStr, 0, 0);
  ctx.restore();

  // --- MEMORY (huge, vertical, center-right) ---
  ctx.save();
  ctx.translate(cx + 40, h * 0.385);
  ctx.rotate(Math.PI / 2);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `900 italic 260px ${fontFamily()}`;
  ctx.fillStyle = "rgba(255,255,255,0.97)";
  ctx.fillText("MEMORY", 0, 0);
  ctx.restore();

  // --- CAPSULE (bottom, horizontal, light + wide tracking) ---
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `300 120px ${fontFamily()}`;
  (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = "16px";
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.fillText("CAN", cx, h * 0.855);
  ctx.restore();

  // --- date range (very bottom, mono, dim) ---
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `400 28px "SF Mono", ui-monospace, Menlo, monospace`;
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.fillText(capsule.dates, cx, h * 0.92);
  ctx.restore();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/** React hook: async font + app-icon load then build the texture. */
export function useMemoryTexture(capsule: Capsule | null) {
  const [texture, setTexture] = useState<THREE.CanvasTexture | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([ensureFont(), ensureAppIcon()]).then(() => {
      if (alive) setTexture(createMemoryTexture(capsule));
    });
    return () => {
      alive = false;
    };
  }, [capsule]);

  return texture;
}
