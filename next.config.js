/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The MCP SDK ships ESM with subpath exports; let Next transpile it cleanly.
  transpilePackages: ['@modelcontextprotocol/sdk', 'mcp-handler'],
};

export default nextConfig;
