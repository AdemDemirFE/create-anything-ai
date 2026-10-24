/** @type {import('next').NextConfig} */
const nextConfig = {
  // Same-origin API proxy: keeps the STACK23_SESSION cookie first-party in
  // dev (`next dev`) and production (`next start`). Override the target
  // with STACK23_API_URL when the backend runs elsewhere.
  async rewrites() {
    const target = process.env.STACK23_API_URL || 'http://localhost:8000'
    return [
      {
        source: '/api/:path*',
        destination: `${target}/api/:path*`,
      },
    ]
  },
}

export default nextConfig
