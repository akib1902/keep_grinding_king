import type { NextConfig } from 'next';

/**
 * The frontend talks to the Fastify backend directly over HTTP/SSE.
 *
 * `NEXT_PUBLIC_API_BASE_URL` is the backend origin (default `http://127.0.0.1:3100`).
 * That origin must also be present in the backend's `CORS_ORIGINS` so that
 * state-changing browser requests are not rejected by the API's origin check.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // The repository root holds the backend's lockfile, so the tracing root is
  // pinned to this app instead of being inferred from the nearest lockfile.
  outputFileTracingRoot: process.cwd(),
  env: {
    NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://127.0.0.1:3100',
  },
};

export default nextConfig;
