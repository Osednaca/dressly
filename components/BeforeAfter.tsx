"use client";

import { useState } from "react";

/**
 * Before / after comparison.
 *
 * The original photo and the generated look are the same frame, so the shopper can
 * drag to see exactly what the AI changed. Labelled **Original** and **Dressly**.
 */
export function BeforeAfter({
  original,
  current,
  alt,
}: {
  original: string;
  current: string;
  alt: string;
}) {
  const [position, setPosition] = useState(58);

  return (
    <div className="relative h-full w-full select-none overflow-hidden">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={current} alt={alt} className="absolute inset-0 h-full w-full object-contain" />
      <div
        className="absolute inset-0 overflow-hidden"
        style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={original}
          alt="Original photo"
          className="absolute inset-0 h-full w-full object-contain"
        />
      </div>

      <div
        className="pointer-events-none absolute inset-y-0 w-px bg-white/80"
        style={{ left: `${position}%` }}
      >
        <span className="absolute top-1/2 left-1/2 flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white/80 bg-black/35 text-white backdrop-blur">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth={1.6}>
            <path d="M9 7l-5 5 5 5M15 7l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </div>

      <input
        type="range"
        min={0}
        max={100}
        value={position}
        onChange={(event) => setPosition(Number(event.target.value))}
        aria-label="Compare original and Dressly look"
        className="compare-range absolute inset-0 h-full w-full cursor-ew-resize opacity-0"
      />

      <span className="pointer-events-none absolute left-3 top-3 rounded-sm bg-black/45 px-2 py-1 text-[10px] uppercase tracking-[0.2em] text-white backdrop-blur">
        Original
      </span>
      <span className="pointer-events-none absolute right-3 top-3 rounded-sm bg-accent/80 px-2 py-1 text-[10px] uppercase tracking-[0.2em] text-white backdrop-blur">
        Dressly
      </span>
    </div>
  );
}
