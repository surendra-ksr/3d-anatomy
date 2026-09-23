import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // FastAPI data service mounted under /api/py/* (server-side proxy, so the
  // browser never needs to reach the backend host directly).
  async rewrites() {
    const backend = process.env.FASTAPI_URL ?? "http://127.0.0.1:8000";
    return [
      {
        source: "/api/py/:path*",
        destination: `${backend}/api/:path*`,
      },
    ];
  },
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
