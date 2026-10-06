"use client";

import type { ReactNode } from "react";
import { FlutedGlass, LinearGradient, Shader } from "shaders/react";
import { dresslyVisualConfig as cfg } from "@/lib/visual/config";
import { useEffectEnabled } from "@/lib/visual/hooks";

/**
 * Frosted fashion-studio glass.
 *
 * The surface is CSS glass — translucent, softly blurred, hairline-edged — so text stays
 * crisp and readable. When `shaderSheen` is on, a thin static fluted-glass strip runs along
 * the top edge, refracting the gradient beneath it like a bevelled pane. It is decorative
 * only and never sits behind body text.
 */
export function DresslyGlass({
  children,
  className = "",
  shaderSheen = false,
  tone = "glass",
}: {
  children: ReactNode;
  className?: string;
  shaderSheen?: boolean;
  tone?: "glass" | "strong";
}) {
  const enabled = useEffectEnabled() && cfg.glassPanels && shaderSheen;
  const surface = tone === "strong" ? "glass-strong" : "glass";

  return (
    <div className={`${surface} relative overflow-hidden rounded-[4px] ${className}`}>
      {enabled ? (
        <Shader
          className="pointer-events-none absolute inset-x-0 top-0 h-14 w-full opacity-35"
          colorSpace="srgb"
          toneMapping="neutral"
        >
          <LinearGradient colorA="#1a120b" colorB="#3a2418" angle={90} colorSpace="oklch" />
          <FlutedGlass
            shape="waves"
            frequency={26}
            softness={0.7}
            refraction={0.8}
            aberration={0.12}
            highlight={0.25}
            highlightSoftness={0.5}
            speed={0}
          />
        </Shader>
      ) : null}
      {children}
    </div>
  );
}
