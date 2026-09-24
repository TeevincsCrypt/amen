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
    return config;
  },
};
export default nextConfig;
