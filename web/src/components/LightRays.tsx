"use client";

export default function LightRays() {
  return (
    <div
      className="pointer-events-none absolute inset-x-0 top-0 h-[55vh] z-[2] overflow-hidden light-rays"
      aria-hidden="true"
    >
      {Array.from({ length: 9 }).map((_, i) => {
        const rot = (i - 4) * 14;
        return (
          <div
            key={i}
            className="ray"
            style={{
              left: "50%",
              top: "-12%",
              width: `${6 + (i % 3) * 2}vw`,
              height: "130%",
              background: `linear-gradient(180deg, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0.06) 35%, transparent 80%)`,
              animationDelay: `${i * 0.35}s`,
              ["--rot" as string]: `${rot}deg`,
            }}
          />
        );
      })}
    </div>
  );
}
