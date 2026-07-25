import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // PGlite and pg ship native/wasm assets that must not be bundled by Turbopack/webpack.
  serverExternalPackages: ['@electric-sql/pglite', 'pg'],
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: false },
  experimental: {
    // Server Actions are used for every mutation in the app.
    serverActions: { bodySizeLimit: '4mb' },
  },
};

export default nextConfig;
