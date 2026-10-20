"use client";

import { useRouter } from "next/navigation";

export default function BackButton({
  children,
  className,
  style,
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => {
        try {
          router.push("/");
        } catch {
          window.location.href = "/";
        }
      }}
      onPointerDown={(e) => {
        e.stopPropagation();
        // Prevent Electron drag region from swallowing the click.
        e.preventDefault();
      }}
      className={className}
      style={{ position: "relative", ...style }}
    >
      {/* invisible larger hit area */}
      <span
        className="absolute -inset-3 rounded-lg"
        aria-hidden="true"
        style={{ pointerEvents: "none" }}
      />
      <span className="relative z-10 flex items-center gap-2">{children}</span>
    </button>
  );
}
