"use client";

import {
  Aurora,
  ChromaFlow,
  CursorTrail,
  FilmGrain,
  LinearGradient,
  Shader,
  Vignette,
} from "shaders/react";
import { ambientFallback, dresslyPalette as p, dresslyVisualConfig as cfg, type AmbientVariant } from "@/lib/visual/config";
import { useAmbientEnabled } from "@/lib/visual/hooks";

/**
 * The signature Dressly environment.
 *
 * A single fixed canvas behind the entire app: a near-black base with a slow, muted
 * aurora (or a liquid metallic flow on the landing hero), finished with a vignette so
 * edges fall away and text panels stay readable. It never sits over content — panels are
 * translucent surfaces layered above it.
 *
 * When WebGPU, motion, or viewport size rule it out, the identical mood is painted with a
 * static CSS gradient, so the composition is always present and never blocks the app.
 */
export function DresslyAmbient({ variant = "global" }: { variant?: AmbientVariant }) {
  const enabled = useAmbientEnabled();

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
      style={{ background: ambientFallback[variant] }}
    >
      {enabled ? (
        <Shader className="absolute inset-0 h-full w-full" colorSpace="srgb" toneMapping="neutral">
          {variant === "hero" ? (
            <>
              <LinearGradient
                colorA={p.void}
                colorB={p.ink}
                angle={120}
                colorSpace="oklch"
              />
              <ChromaFlow
                baseColor={p.void}
                upColor={p.clay}
                downColor={p.smoke}
                leftColor={p.ember}
                rightColor={p.champagne}
                intensity={0.7}
                radius={2.6}
                momentum={26}
                opacity={0.6}
              />
              <FilmGrain strength={0.1} bias={4} />
              <Vignette color="#070605" intensity={0.5} radius={0.78} falloff={0.72} />
              {cfg.heroCursor ? (
                <CursorTrail
                  colorA={p.clayBright}
                  colorB={p.champagne}
                  radius={0.7}
                  length={0.6}
                  shrink={1}
                  softness={0.65}
                  opacity={0.2}
                />
              ) : null}
            </>
          ) : variant === "cinematic" ? (
            <>
              <LinearGradient
                colorA="#0a0908"
                colorB="#1b120b"
                angle={110}
                colorSpace="oklch"
              />
              <Aurora
                colorA={p.ember}
                colorB={p.champagne}
                colorC={p.smoke}
                intensity={34}
                speed={1.6}
                curtainCount={3}
                waviness={30}
                rayDensity={10}
                height={95}
                opacity={0.5}
              />
              <FilmGrain strength={0.12} bias={4} />
              <Vignette color="#060505" intensity={0.6} radius={0.7} falloff={0.75} />
            </>
          ) : (
            <>
              <LinearGradient
                colorA="#0b0a09"
                colorB={p.ink}
                angle={140}
                colorSpace="oklch"
              />
              <Aurora
                colorA="#2a1c12"
                colorB="#5c422a"
                colorC="#1a120c"
                intensity={22}
                speed={1.2}
                curtainCount={3}
                waviness={26}
                rayDensity={9}
                height={80}
                opacity={0.4}
              />
              <FilmGrain strength={0.09} bias={4} />
              <Vignette color="#060505" intensity={0.5} radius={0.8} falloff={0.7} />
            </>
          )}
        </Shader>
      ) : null}
    </div>
  );
}
