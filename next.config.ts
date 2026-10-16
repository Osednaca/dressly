import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["playwright-core", "sharp"],
  // Origins allowed to reach the dev server through a proxy/tunnel. Needed when the
  // app is exposed on a public HTTPS host (e.g. a Cloudflare quick tunnel) so Next's
  // dev-time cross-origin protection does not block requests. Also gives the browser a
  // secure context, which the microphone / Web Speech API requires.
  allowedDevOrigins: [
    "surrounding-adapted-lawsuit-abstracts.trycloudflare.com",
    "*.trycloudflare.com",
  ],
  // The upload endpoint receives real photographs; allow a comfortable margin over
  // Next's 1MB default so a full-body phone photo is not rejected before YouCam sees it.
  experimental: {
    serverActions: {
      bodySizeLimit: "12mb",
    },
  },
  images: {
    // YouCam returns signed S3 result URLs that expire; we re-host results locally,
    // so only product/store assets are ever optimized from disk.
    remotePatterns: [
      { protocol: "https", hostname: "**.amazonaws.com" },
      { protocol: "https", hostname: "**.makeupar.com" },
      { protocol: "https", hostname: "**.trycloudflare.com" },
    ],
  },
};

export default nextConfig;
