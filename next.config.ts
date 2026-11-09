import type { NextConfig } from 'next';
import { HSTS_HEADER, SECURITY_HEADERS } from './lib/http/security';

const nextConfig: NextConfig = {
  output: 'standalone',
  // Removes the default X-Powered-By: Next.js header.
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: Object.entries(SECURITY_HEADERS).map(([key, value]) => ({ key, value })),
      },
      {
        // HSTS only for requests that arrived over TLS (Caddy sets X-Forwarded-Proto).
        source: '/:path*',
        has: [{ type: 'header', key: 'x-forwarded-proto', value: 'https' }],
        headers: [{ key: 'Strict-Transport-Security', value: HSTS_HEADER }],
      },
    ];
  },
};

export default nextConfig;
