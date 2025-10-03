/** @type {import('next').NextConfig} */
const nextConfig = {
  // Enable standalone output for Docker
  output: 'standalone',
  
  // External packages for server components
  serverExternalPackages: ['better-sqlite3', '@mastra/fastembed'],
};

export default nextConfig;
