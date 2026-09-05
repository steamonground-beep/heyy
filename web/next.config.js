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
      // WebSocket routes
      {
        source: '/ws/:username/:instanceId/:path*',
        destination: '/api/proxy-instance/:username/:instanceId/:path*',
      },
    ];
  },
};

module.exports = nextConfig;
