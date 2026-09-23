import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Produce .next/standalone for the production Docker image (Dockerfile).
  output: "standalone",

  // NOTE: /api/py/* is proxied by middleware.ts (not a rewrite here) so the
  // authenticated user's internal bearer token can be attached to every
  // backend call. The browser only ever talks to the Next origin.
  async headers() {
    return [
      {
        // Draco GLBs are immutable artifacts
        source: "/models/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
    ];
  },
};

export default nextConfig;
