import { createConfig, http, injected, type CreateConnectorFn } from "wagmi";
import { walletConnect } from "wagmi/connectors";
import { activeChain } from "./chains";

/**
 * WalletConnect (mobile wallets, QR code) is on only when a project id is set: create one for
 * free at https://cloud.reown.com and set NEXT_PUBLIC_WC_PROJECT_ID on Vercel.
 */
export const WC_PROJECT_ID = process.env.NEXT_PUBLIC_WC_PROJECT_ID ?? "";

const connectors: CreateConnectorFn[] = [injected({ shimDisconnect: true })];
// Browser only: the connector opens a relay session at setup, which is pointless during server rendering.
if (WC_PROJECT_ID && typeof window !== "undefined") {
  connectors.push(
    walletConnect({
      projectId: WC_PROJECT_ID,
      showQrModal: true,
      // The theme is already on <html> (set in <head> before this runs); the popup matches it.
      qrModalOptions: { themeMode: document.documentElement.dataset.theme === "light" ? "light" : "dark" },
      metadata: {
        name: "Amen",
        description: "The after-hours venue for Robinhood Stock Tokens",
        url: window.location.origin,
        icons: [`${window.location.origin}/icon.svg`],
      },
    }),
  );
}

export const wagmiConfig = createConfig({
  chains: [activeChain],
  connectors,
  transports: { [activeChain.id]: http(activeChain.rpcUrls.default.http[0], { retryCount: 1 }) },
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
