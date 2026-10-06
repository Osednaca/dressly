import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
    ],
  },
};

export default nextConfig;
