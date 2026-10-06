"use client";

import { useEffect, useState } from "react";
import { getWebGPUSupport, isWebGPUSupported } from "shaders/react";
import { dresslyVisualConfig } from "@/lib/visual/config";

/**
 * Client-only capability hooks.
 *
 * They all start `false`/`null` on the server and settle after mount, so a shader canvas
 * is never part of the server HTML and never causes a hydration mismatch. Crucially, none
 * of them block initialization: the app renders its static CSS fallback immediately and
 * upgrades to the GPU treatment only once support is confirmed.
 */

/** True only when a real WebGPU adapter was granted. */
export function useShaderSupport(): boolean {
  const [supported, setSupported] = useState(false);

  useEffect(() => {
    if (!isWebGPUSupported()) return;
    let alive = true;
    getWebGPUSupport()
      .then((info) => {
        if (alive) setSupported(info.supported);
      })
      .catch(() => {
        if (alive) setSupported(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  return supported;
}

/** Tracks `prefers-reduced-motion: reduce`. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return reduced;
}

/** Generic media-query hook. Returns false on the server. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener("change", update);
    return () => list.removeEventListener("change", update);
  }, [query]);

  return matches;
}

/**
 * The single gate for ambient GPU motion: a working GPU, motion allowed, and a viewport
 * wide enough to justify it. On mobile the static gradient is used instead.
 */
export function useAmbientEnabled(): boolean {
  const supported = useShaderSupport();
  const reduced = usePrefersReducedMotion();
  const wide = useMediaQuery(`(min-width: ${dresslyVisualConfig.ambientMinWidth}px)`);

  if (!dresslyVisualConfig.ambientMotion) return false;
  if (dresslyVisualConfig.reducedMotionFallback && reduced) return false;
  return supported && wide;
}

/** Shader treatments that are fine on mobile too (loading, transition, glow). */
export function useEffectEnabled(): boolean {
  const supported = useShaderSupport();
  const reduced = usePrefersReducedMotion();
  if (dresslyVisualConfig.reducedMotionFallback && reduced) return false;
  return supported;
}
