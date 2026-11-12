// Next.js config. The database work stays in the Express API (backend/, port 4000);
// every browser call to /api/... is forwarded there, exactly like the old Vite proxy.
const API_URL = process.env.API_URL || 'http://localhost:4000';

/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API_URL}/api/:path*` }];
  },
};

export default nextConfig;
