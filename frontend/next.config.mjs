import { createRequire } from "node:module";
import { dirname, join } from "node:path";

// `wagmi/connectors` re-exports every wallet SDK (Coinbase, MetaMask, Base, Porto…), and some of
// those import optional packages that aren't installed. Amen uses only the WalletConnect
// connector, so resolve that import to its one file. Types still come from wagmi/connectors.
const require = createRequire(import.meta.url);
const walletConnectConnector = join(dirname(require.resolve("@wagmi/connectors")), "..", "walletConnect.js");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The app moved under /app when the landing page took "/".
  async redirects() {
    return [
      { source: "/vault", destination: "/app/vault", permanent: false },
      { source: "/markets", destination: "/app/markets", permanent: false },
    ];
  },
  webpack: (config) => {
    // wagmi/walletconnect optional deps we don't use
    config.externals.push("pino-pretty", "lokijs", "encoding");
    config.resolve.alias = { ...config.resolve.alias, "wagmi/connectors$": walletConnectConnector };
    return config;
  },
};
export default nextConfig;
