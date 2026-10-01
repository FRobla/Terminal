import path from "node:path";
import { loadTerminalServerEnvironment } from "@sct/config";
import type { NextConfig } from "next";

// The monorepo keeps one `.env` at the root (OPERATIONS.md §3). Existing variables win.
try {
  process.loadEnvFile(path.resolve(process.cwd(), "../../.env"));
} catch {
  // No root .env (e.g. CI): variables come from the environment.
}

// FND-AC-03 / NET-AC-04: fail fast on invalid configuration, including cluster disagreement.
const env = loadTerminalServerEnvironment();

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  ...(env.PUBLIC_APP_ORIGIN.startsWith("https:")
    ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]
    : []),
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: ["@sct/ui", "@sct/validation", "@sct/network", "@sct/config"],
  async rewrites() {
    // Same-origin API access: cookies stay SameSite=Strict and CORS stays disabled (ARCHITECTURE.md §17).
    return [{ source: "/api/v1/:path*", destination: `${env.API_INTERNAL_URL}/api/v1/:path*` }];
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
