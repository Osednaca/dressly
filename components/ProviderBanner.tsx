"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client/api";
import type { ProvidersResponse } from "@/lib/api-types";

/**
 * Truthful provider status.
 *
 * When mock mode is on, or a credential is missing, this says so plainly and
 * persistently — a simulated try-on must never be mistaken for a real one.
 */
export function ProviderBanner() {
  const [data, setData] = useState<ProvidersResponse | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .providers()
      .then((value) => {
        if (alive) setData(value);
      })
      .catch(() => {
        if (alive) setData(null);
      });
    return () => {
      alive = false;
    };
  }, []);

  if (!data) return null;

  const live = data.statuses.filter((status) => status.active).length;
  const total = data.statuses.length;

  return (
    <div className="relative z-10 border-b border-line bg-paper-deep/60">
      <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-x-5 gap-y-1 px-6 py-2 md:px-10">
        <span className="overline text-muted">
          {data.mock ? "Simulation" : `${live}/${total} providers live`}
        </span>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {data.statuses.map((status) => (
            <span key={status.id} className="flex items-center gap-1.5 text-[11px] text-ink-soft">
              <span
                className="inline-block h-1.5 w-1.5 rounded-full"
                style={{ background: status.active ? "var(--color-sage)" : "var(--color-line-strong)" }}
              />
              {status.label}
              <span className="text-muted">· {status.detail}</span>
            </span>
          ))}
        </div>
        {data.degraded && !data.mock ? (
          <span className="text-[11px] text-accent">
            Running without one or more provider keys — deterministic fallbacks in use.
          </span>
        ) : null}
        {data.mock ? (
          <span className="text-[11px] font-semibold text-accent">
            DRESSLY_MOCK_EXTERNAL_APIS=true — results are simulated, not real.
          </span>
        ) : null}
      </div>
    </div>
  );
}
