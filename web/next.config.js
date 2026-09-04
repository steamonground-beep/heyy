/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [
      // Game server routes
      {
        source: '/play/:username/:instanceId/:path*',
        destination: '/api/proxy-instance/:username/:instanceId/:path*',
      },
      {
        source: '/play/:username/:instanceId',
        destination: '/api/proxy-instance/:username/:instanceId',
      },
      // API endpoint routes for game client compatibility
      {
        source: '/api/:username/:instanceId/:path*',
        destination: '/api/proxy-instance/:username/:instanceId/:path*',
      },
      // WebSocket routes
      {
        source: '/ws/:username/:instanceId/:path*',
        destination: '/api/proxy-instance/:username/:instanceId/:path*',
      },
    ];
  },
};

module.exports = nextConfig;
