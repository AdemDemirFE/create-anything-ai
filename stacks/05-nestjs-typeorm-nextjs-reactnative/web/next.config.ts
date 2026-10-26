import type { NextConfig } from 'next'
import path from 'node:path'

const nextConfig: NextConfig = {
  // The shared layer (API client + envelope) lives OUTSIDE the web root and
  // is consumed by BOTH the web app and the RN shell — wire it explicitly
  // (Next transpiles it as source).
  experimental: {
    externalDir: true,
  },
  webpack: (config) => {
    config.resolve.alias['@shared'] = path.resolve(__dirname, '../shared/src')
    // The shared layer is authored with NodeNext module resolution (`.js`
    // extensions referring to `.ts` sources) — teach webpack that mapping.
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
    }
    return config
  },
  // Dev proxy keeps the API same-origin so the HttpOnly session cookie works
  // without CORS surprises (mirrors the stack-18/19 pattern).
  async rewrites() {
    const api = process.env['API_ORIGIN'] ?? 'http://localhost:4000'
    return [{ source: '/api/v1/:path*', destination: `${api}/api/v1/:path*` }]
  },
}

export default nextConfig
