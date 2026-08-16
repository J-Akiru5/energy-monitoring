"use client";

import { useEffect, useRef } from "react";

/**
 * Decorative backdrop for the landing hero: a hand-drawn-feeling trace line
 * and a handful of scattered "spark" marks — deliberately off-grid,
 * deliberately uneven sizes/opacities, with light mouse parallax.
 *
 * Positions are hand-placed (not Math.random()) so server and client render
 * identically — no hydration mismatch, no layout jump on load.
 */
const SPARKS = [
  { x: 8, y: 18, size: 5, depth: 10, opacity: 0.9, color: "var(--accent-cyan)", delay: 0 },
  { x: 22, y: 9, size: 3, depth: 22, opacity: 0.55, color: "var(--accent-amber)", delay: 0.6 },
  { x: 34, y: 30, size: 4, depth: 14, opacity: 0.7, color: "var(--accent-blue)", delay: 1.3 },
  { x: 61, y: 12, size: 6, depth: 8, opacity: 0.85, color: "var(--accent-cyan)", delay: 0.2 },
  { x: 78, y: 24, size: 3, depth: 26, opacity: 0.5, color: "var(--accent-amber)", delay: 1.8 },
  { x: 88, y: 8, size: 4, depth: 16, opacity: 0.65, color: "var(--accent-blue)", delay: 0.9 },
  { x: 15, y: 62, size: 3, depth: 20, opacity: 0.45, color: "var(--accent-blue)", delay: 2.1 },
  { x: 70, y: 68, size: 5, depth: 12, opacity: 0.6, color: "var(--accent-cyan)", delay: 1.1 },
  { x: 92, y: 55, size: 3, depth: 24, opacity: 0.4, color: "var(--accent-amber)", delay: 0.4 },
  { x: 46, y: 84, size: 4, depth: 18, opacity: 0.5, color: "var(--accent-cyan)", delay: 1.6 },
];

export function LandingScene() {
  const sceneRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    const el = sceneRef.current;
    if (!el) return;

    // Respect reduced-motion: skip the parallax listener entirely.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    function handlePointerMove(event: PointerEvent) {
      if (frameRef.current !== null) return;
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const mx = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        const my = ((event.clientY - rect.top) / rect.height) * 2 - 1;
        el.style.setProperty("--mx", mx.toFixed(3));
        el.style.setProperty("--my", my.toFixed(3));
      });
    }

    window.addEventListener("pointermove", handlePointerMove);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, []);

  return (
    <div className="landing-scene" ref={sceneRef} aria-hidden="true">
      <svg
        className="landing-waveform"
        viewBox="0 0 1000 500"
        preserveAspectRatio="none"
        fill="none"
      >
        <path
          d="M -20 340 C 90 300, 140 400, 230 360 S 380 220, 470 260 S 620 420, 720 340 S 880 160, 1020 210"
          stroke="url(#landing-trace-gradient)"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <defs>
          <linearGradient id="landing-trace-gradient" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--accent-cyan)" stopOpacity="0" />
            <stop offset="20%" stopColor="var(--accent-cyan)" stopOpacity="0.5" />
            <stop offset="55%" stopColor="var(--accent-blue)" stopOpacity="0.4" />
            <stop offset="100%" stopColor="var(--accent-amber)" stopOpacity="0" />
          </linearGradient>
        </defs>
      </svg>

      {SPARKS.map((spark, i) => (
        <span
          key={i}
          className="landing-spark"
          style={
            {
              left: `${spark.x}%`,
              top: `${spark.y}%`,
              width: spark.size,
              height: spark.size,
              background: spark.color,
              color: spark.color,
              "--base-opacity": spark.opacity,
              "--spark-delay": `${spark.delay}s`,
              "--depth": spark.depth,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}
