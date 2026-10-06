/**
 * Dressly visual configuration.
 *
 * One place to tune (or switch off) every GPU treatment. This exists so an effect that
 * misbehaves on a demo machine — or during a live recording — can be disabled in a single
 * edit without touching the components that use it.
 *
 * Shaders enhance the product; they never become the product. Everything here is
 * deliberately restrained and defaults to on only for the subtle, cheap treatments.
 */
export const dresslyVisualConfig = {
  /** Slow ambient depth behind the whole app. */
  ambientMotion: true,
  /** Subtle cursor-reactive motion on the landing hero only. */
  heroCursor: true,
  /** Shader wipe when YouCam returns a new look. */
  outfitTransition: true,
  /** Fluted-glass sheen on the stylist panel header. */
  glassPanels: true,
  /** Flowing shader behind the "styling your look" state. */
  loadingShader: true,
  /** Cinematic ambient on the final look screen. */
  cinematicFinal: true,
  /** Honour prefers-reduced-motion by falling back to static surfaces. */
  reducedMotionFallback: true,
  /** Below this viewport width, only the static CSS gradient is rendered. */
  ambientMinWidth: 768,
  /** Transition length for a new look, in ms. */
  transitionMs: 760,
} as const;

/**
 * The restrained Dressly palette. Muted warm neutrals, clay and champagne accents —
 * never rainbow. Shared by the shaders and the CSS fallbacks so they read as one system.
 */
export const dresslyPalette = {
  void: "#0b0a09",
  ink: "#14110d",
  charcoal: "#1a140d",
  clay: "#6b4a2e",
  clayBright: "#c8845a",
  champagne: "#8a6a44",
  champagneSoft: "#e0a97f",
  smoke: "#241a12",
  ember: "#3a2418",
  ivory: "#f2ede3",
} as const;

export type AmbientVariant = "global" | "hero" | "cinematic";

/** Static CSS gradients used when WebGPU, motion, or viewport size rule the shader out. */
export const ambientFallback: Record<AmbientVariant, string> = {
  global:
    "radial-gradient(120% 90% at 50% -10%, #1a140d 0%, #0e0d0b 45%, #0b0a09 100%)",
  hero:
    "radial-gradient(130% 100% at 70% 0%, #241a12 0%, #14100b 40%, #0a0908 100%)",
  cinematic:
    "radial-gradient(120% 100% at 50% 0%, #2a1c12 0%, #140f0a 45%, #080706 100%)",
};
