"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";

/**
 * Simulation notice.
 *
 * Shoppers never see provider or credential status. The one thing that must stay
 * visible is mock mode: a simulated try-on must never be mistaken for a real one.
 */
export function ProviderBanner() {
  const [mock, setMock] = useState(false);

  useEffect(() => {
    let alive = true;
    api
      .providers()
      .then((value) => {
        if (alive) setMock(value.mock);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  if (!mock) return null;

  return (
    <div className="relative z-10 border-b border-chrome/10 bg-background/40 backdrop-blur-md">
      <p className="mx-auto max-w-[1500px] px-6 py-2 text-[11px] font-semibold text-accent md:px-10">
        Preview mode — try-on results are simulated.
      </p>
    </div>
  );
}
