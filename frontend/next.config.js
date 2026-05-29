/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  compiler: {
    removeConsole: process.env.NODE_ENV === "production",
  },
  async rewrites() {
    // BACKEND_URL is a server-side env var (set in Render dashboard or .env).
    // Falls back to NEXT_PUBLIC_API_URL, then localhost for local dev.
    const backendUrl =
      process.env.BACKEND_URL ||
      process.env.NEXT_PUBLIC_API_URL ||
      "http://localhost:8000";
    return [
      { source: "/api/:path*",   destination: `${backendUrl}/api/:path*` },
      { source: "/health/deep", destination: `${backendUrl}/health/deep` },
      { source: "/health",      destination: `${backendUrl}/health` },
    ];
  },
};

module.exports = nextConfig;
