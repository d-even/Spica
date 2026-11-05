import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
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
