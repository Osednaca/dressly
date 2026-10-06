"use client";

import type { ReactNode } from "react";
import { RadialGradient, Shader } from "shaders/react";
import { useEffectEnabled } from "@/lib/visual/hooks";

/**
 * A restrained champagne halo for the one thing that matters most in a given moment —
 * the selected garment, or the primary call to action.
 *
 * A CSS shadow guarantees the glow on every device; when WebGPU is available a soft
 * radial shader adds a little more life behind it. It is deliberately subtle: a highlight,
 * not a spotlight.
 */
export function DresslyGlow({
  active = true,
  className = "",
  children,
}: {
  active?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const enabled = useEffectEnabled();

  return (
    <span className={`relative ${className}`}>
      {active ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -inset-2 rounded-[inherit]"
          style={{ boxShadow: "0 0 48px -10px rgba(200,132,90,0.5)" }}
        />
      ) : null}

      {active && enabled ? (
        <Shader
          className="pointer-events-none absolute -inset-6"
          style={{ mixBlendMode: "screen" }}
          colorSpace="srgb"
          toneMapping="neutral"
        >
          <RadialGradient
            colorA="#c8845a"
            colorB="#000000"
            center={{ x: 0.5, y: 0.5 }}
            radius={0.55}
            opacity={0.45}
          />
        </Shader>
      ) : null}

      <span className="relative">{children}</span>
    </span>
  );
}
