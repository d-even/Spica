import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // Lets a device on the local network open the dev server. Update it if this machine's IP changes.
  allowedDevOrigins: ["10.71.164.217"],
  // These SDKs use Node APIs and gRPC, so they are loaded at runtime instead of bundled.
  serverExternalPackages: ["@hiero-ledger/sdk", "@x402/hedera", "@circle-fin/x402-batching"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
