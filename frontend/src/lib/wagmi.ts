import { createConfig, http, injected } from "wagmi";
import { activeChain } from "./chains";

export const wagmiConfig = createConfig({
  chains: [activeChain],
  connectors: [injected({ shimDisconnect: true })],
  transports: { [activeChain.id]: http(activeChain.rpcUrls.default.http[0]) },
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
