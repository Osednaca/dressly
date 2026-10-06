"use client";

import { useEffect, useRef, useState } from "react";
import { ImageTexture, RippleWipe, Shader } from "shaders/react";
import { BeforeAfter } from "@/components/BeforeAfter";
import { dresslyVisualConfig as cfg } from "@/lib/visual/config";
import { useEffectEnabled } from "@/lib/visual/hooks";
import type { Look } from "@/lib/types";

/**
 * The fitting-room stage image, with the signature outfit transition.
 *
 * When YouCam returns a new look it is not swapped in instantly: the previous render stays
 * on screen while the new one is wiped in by a shader ripple, so the shopper sees Dressly
 * change the look. The transition only ever covers the frame; the settled image is a plain,
 * unmodified `<img>` (or the before/after slider), so the garment is never misrepresented.
 *
 * Without WebGPU or with reduced motion, the new look simply appears — the app is never
 * blocked and never depends on the effect.
 */
export function LookStage({
  look,
  photoPath,
  alt,
}: {
  look?: Look;
  photoPath: string | null;
  alt: string;
}) {
  const shaderReady = useEffectEnabled() && cfg.outfitTransition;
  const [displayed, setDisplayed] = useState<Look | undefined>(look);
  const [incoming, setIncoming] = useState<Look | undefined>(undefined);
  const [progress, setProgress] = useState(1);

  const latest = useRef(look);
  latest.current = look;

  useEffect(() => {
    const next = latest.current;
    if (!next) {
      setDisplayed(undefined);
      return;
    }
    if (displayed?.id === next.id) return;

    if (!shaderReady) {
      setDisplayed(next);
      return;
    }

    setIncoming(next);
    setProgress(1);
    const start = performance.now();
    const duration = cfg.transitionMs;
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      setProgress(1 - eased);
      if (t < 1) {
        frame = requestAnimationFrame(tick);
      } else {
        setDisplayed(next);
        setIncoming(undefined);
      }
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [look?.id, displayed, shaderReady]);

  return (
    <div className="absolute inset-0">
      {displayed ? (
        displayed.previousImagePath ? (
          <BeforeAfter
            original={displayed.previousImagePath}
            current={displayed.imagePath}
            alt={alt}
          />
        ) : (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={displayed.imagePath}
            alt={alt}
            className="absolute inset-0 h-full w-full object-contain"
          />
        )
      ) : photoPath ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={photoPath}
          alt="Your photo"
          className="absolute inset-0 h-full w-full object-contain"
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-white/40">
          <p className="text-sm">Add a photo to begin.</p>
        </div>
      )}

      {incoming && shaderReady ? (
        <Shader
          className="pointer-events-none absolute inset-0 h-full w-full"
          colorSpace="srgb"
          toneMapping="neutral"
        >
          <ImageTexture url={incoming.imagePath} objectFit="contain" />
          <RippleWipe
            progress={progress}
            center={{ x: 0.5, y: 0.42 }}
            rings={7}
            feather={0.3}
          />
        </Shader>
      ) : null}
    </div>
  );
}
