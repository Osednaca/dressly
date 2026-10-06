"use client";

import { ChromaFlow, LinearGradient, Shader, Vignette } from "shaders/react";
import { dresslyVisualConfig as cfg } from "@/lib/visual/config";
import { useEffectEnabled } from "@/lib/visual/hooks";

/**
 * The "Dressly is styling your look" environment.
 *
 * A slow liquid gradient behind the named loading steps. Its energy rises with progress —
 * calm while understanding, richer while the virtual fit is generated — so the wait reads
 * as work being done rather than a frozen spinner. The step text always sits above it on
 * a stable surface.
 */
export function DresslyLoadingShader({ progress = 0 }: { progress?: number }) {
  const enabled = useEffectEnabled();
  if (!enabled || !cfg.loadingShader) return null;

  const t = Math.min(1, Math.max(0, progress));

  return (
    <Shader
      className="pointer-events-none absolute inset-0 h-full w-full"
      colorSpace="srgb"
      toneMapping="neutral"
    >
      <LinearGradient colorA="#0a0908" colorB="#1a120b" angle={130} colorSpace="oklch" />
      <ChromaFlow
        baseColor="#0e0b08"
        upColor="#6b4a2e"
        downColor="#1a120c"
        leftColor="#2a1c12"
        rightColor="#c8845a"
        intensity={0.5 + t * 0.6}
        radius={2.4 + t * 0.7}
        momentum={24}
        opacity={0.5 + t * 0.28}
      />
      <Vignette color="#060505" intensity={0.5} radius={0.74} falloff={0.72} />
    </Shader>
  );
}
