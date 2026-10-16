import type { TryOnEngine, TryOnHandle, TryOnRequest, TryOnState } from "@/services/contracts";

/**
 * Development-only stand-in for YouCam.
 *
 * It exists so the UI, the loading states and the agent loop can be built without a
 * credential. It deliberately produces something a human cannot mistake for a real
 * try-on: the user's photo with the garment pinned beside it and a large watermark.
 *
 * Mock results are never acceptable for a recorded or judged demo, and the UI
 * banner says so whenever this engine is the one wired up.
 */

interface PendingMock {
  request: TryOnRequest;
  startedAt: number;
  /** Fake latency, so the multi-step loading experience is exercised for real. */
  readyAt: number;
}

const pending = new Map<string, PendingMock>();
let counter = 0;

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function dataUri(bytes: Buffer, contentType: string): string {
  return `data:${contentType};base64,${bytes.toString("base64")}`;
}

/** A composite that shows what was asked for, clearly labelled as a simulation. */
function renderMock(request: TryOnRequest): Buffer {
  const person = dataUri(request.personImage, request.personContentType);
  const garment = dataUri(request.garmentImage, request.garmentContentType);
  const width = 900;
  const height = 1200;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="scrim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0.55" stop-color="#000" stop-opacity="0"/>
      <stop offset="1" stop-color="#000" stop-opacity="0.72"/>
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="#111111"/>
  <image href="${person}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice"/>
  <rect width="${width}" height="${height}" fill="url(#scrim)"/>
  <g transform="translate(${width - 300} 120)">
    <rect x="0" y="0" width="240" height="300" rx="18" fill="#ffffff" opacity="0.94"/>
    <image href="${garment}" x="24" y="24" width="192" height="220" preserveAspectRatio="xMidYMid meet"/>
    <text x="120" y="278" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="19" fill="#111111">${escapeXml(
      request.garmentName,
    )}</text>
  </g>
  <g transform="translate(${width / 2} ${height / 2}) rotate(-22)">
    <text text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="54" font-weight="700" fill="#ffffff" fill-opacity="0.34">MOCK RESULT</text>
    <text y="46" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="24" fill="#ffffff" fill-opacity="0.34">DRESSLY_MOCK_EXTERNAL_APIS=true</text>
  </g>
  <text x="40" y="${height - 46}" font-family="Helvetica, Arial, sans-serif" font-size="26" fill="#ffffff" fill-opacity="0.85">Development simulation — not a real YouCam try-on</text>
</svg>`;

  return Buffer.from(svg, "utf8");
}

export const mockYoucamEngine: TryOnEngine = {
  provider: "mock",

  async submit(request: TryOnRequest): Promise<TryOnHandle> {
    counter += 1;
    const id = `mock_${counter}_${Date.now()}`;
    const taskKind = request.taskKind ?? "cloth-v4";
    pending.set(id, {
      request,
      startedAt: Date.now(),
      readyAt: Date.now() + (taskKind === "bag" ? 0 : 2200),
    });
    return { id, provider: "mock", taskKind };
  },

  async poll(handle: TryOnHandle): Promise<TryOnState> {
    const entry = pending.get(handle.id);
    if (!entry) {
      return {
        status: "failed",
        provider: "mock",
        id: handle.id,
        message: "mock try-on job is no longer available (server restarted?)",
        retryable: true,
      };
    }
    if (Date.now() < entry.readyAt) {
      return { status: "pending", provider: "mock", id: handle.id };
    }
    return {
      status: "success",
      provider: "mock",
      id: handle.id,
      image: renderMock(entry.request),
      contentType: "image/svg+xml",
    };
  },
};
