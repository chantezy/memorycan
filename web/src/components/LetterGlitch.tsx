"use client";

import { useEffect, useRef } from "react";

const CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZ!@#$&*()-_+=/[]{};:<>.,0123456789".split("");
// ReactBits letter-glitch palette (matrix greens/teals)
const PALETTE = ["#1b3b2e", "#3dd682", "#61dca3", "#61b3dc"];

interface Cell {
  char: string;
  color: string;
}

/** Letter glitch background à la ReactBits — big, clearly visible. */
export default function LetterGlitch() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    let raf = 0;
    let last = 0;
    let cells: Cell[] = [];
    let cols = 0;
    const size = 26; // bigger characters

    const randChar = () => CHARS[Math.floor(Math.random() * CHARS.length)];
    // 75% dim green, 25% bright green/teal
    const randColor = () => {
      if (Math.random() < 0.75) return PALETTE[0];
      const r = Math.random();
      return r < 0.5 ? PALETTE[1] : r < 0.8 ? PALETTE[2] : PALETTE[3];
    };

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = canvas.clientWidth * dpr;
      canvas.height = canvas.clientHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cols = Math.ceil(canvas.clientWidth / size);
      const rows = Math.ceil(canvas.clientHeight / size);
      cells = Array.from({ length: cols * rows }, () => ({
        char: randChar(),
        color: randColor(),
      }));
      draw();
    };

    const draw = () => {
      ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
      ctx.font = `600 ${size * 0.72}px ui-monospace, "SF Mono", Menlo, monospace`;
      ctx.textBaseline = "top";
      for (let i = 0; i < cells.length; i++) {
        const cell = cells[i];
        const x = (i % cols) * size;
        const y = Math.floor(i / cols) * size;
        ctx.fillStyle = cell.color;
        ctx.fillText(cell.char, x, y);
      }
    };

    const step = (now: number) => {
      raf = requestAnimationFrame(step);
      if (now - last < 90) return; // glitch cadence
      last = now;
      const updates = Math.max(10, Math.floor(cells.length * 0.05));
      for (let n = 0; n < updates; n++) {
        const i = Math.floor(Math.random() * cells.length);
        cells[i].char = randChar();
        cells[i].color = randColor();
      }
      draw();
    };

    resize();
    window.addEventListener("resize", resize);
    raf = requestAnimationFrame(step);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <div className="relative w-full h-full">
      <canvas ref={canvasRef} className="w-full h-full block" aria-hidden="true" />
      {/* vignette: strong edge-inward black fade so the center pops */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "linear-gradient(to right, rgba(0,0,0,0.9) 0%, transparent 16%, transparent 84%, rgba(0,0,0,0.9) 100%), linear-gradient(to bottom, rgba(0,0,0,0.9) 0%, transparent 14%, transparent 78%, rgba(0,0,0,0.95) 100%), radial-gradient(ellipse 82% 82% at center, transparent 16%, rgba(0,0,0,0.5) 56%, rgba(0,0,0,0.92) 100%)",
        }}
        aria-hidden="true"
      />
    </div>
  );
}
