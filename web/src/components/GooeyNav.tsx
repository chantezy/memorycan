"use client";

import { useEffect, useRef, useState } from "react";

interface NavItem {
  label: string;
  href?: string;
  onClick?: () => void;
}

interface GooeyNavProps {
  items: NavItem[];
  className?: string;
}

export default function GooeyNav({ items, className = "" }: GooeyNavProps) {
  const [hovered, setHovered] = useState<number | null>(null);
  const navRef = useRef<HTMLElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | HTMLAnchorElement | null)[]>([]);
  const [pill, setPill] = useState({ left: 0, width: 0, opacity: 0 });

  useEffect(() => {
    if (hovered == null || !navRef.current) {
      setPill((p) => ({ ...p, opacity: 0 }));
      return;
    }
    const el = itemRefs.current[hovered];
    if (!el) return;
    const parentRect = navRef.current.getBoundingClientRect();
    const rect = el.getBoundingClientRect();
    setPill({
      left: rect.left - parentRect.left,
      width: rect.width,
      opacity: 1,
    });
  }, [hovered, items]);

  const handleClick = (_i: number, item: NavItem) => {
    item.onClick?.();
  };

  return (
    <nav
      ref={navRef}
      className={`relative inline-flex items-center gap-1 ${className}`}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <svg className="absolute w-0 h-0" aria-hidden="true">
        <defs>
          <filter id="gooey-nav-filter" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="blur" />
            <feColorMatrix
              in="blur"
              mode="matrix"
              values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -9"
              result="goo"
            />
            <feComposite in="SourceGraphic" in2="goo" operator="atop" />
          </filter>
        </defs>
      </svg>

      {/* gooey highlight pill */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ filter: "url(#gooey-nav-filter)" }}
        aria-hidden="true"
      >
        <span
          className="absolute top-1/2 h-[calc(100%-6px)] -translate-y-1/2 rounded-full bg-white"
          style={{
            left: pill.left,
            width: pill.width,
            opacity: pill.opacity,
            transition: "left 0.35s cubic-bezier(0.34, 1.56, 0.64, 1), width 0.35s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.2s ease",
          }}
        />
      </div>

      {items.map((item, i) => {
        const common =
          "relative z-10 px-5 py-2 text-xs font-medium tracking-widest uppercase rounded-full transition-colors duration-300 text-white/80 hover:text-black";
        return item.href ? (
          <a
            key={item.label}
            ref={(el) => {
              itemRefs.current[i] = el;
            }}
            href={item.href}
            className={common}
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(null)}
            onClick={() => handleClick(i, item)}
          >
            {item.label}
          </a>
        ) : (
          <button
            key={item.label}
            ref={(el) => {
              itemRefs.current[i] = el;
            }}
            type="button"
            className={common}
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(null)}
            onClick={() => handleClick(i, item)}
          >
            {item.label}
          </button>
        );
      })}
    </nav>
  );
}
