import { defineChain, type Chain } from "viem";

/** Robinhood Chain mainnet — official RPC params (docs.robinhood.com/chain/connecting). */
export const robinhood = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.chain.robinhood.com"] } },
  blockExplorers: { default: { name: "Blockscout", url: "https://robinhoodchain.blockscout.com" } },
  contracts: { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" } },
});

export const robinhoodTestnet = defineChain({
  id: 46630,
  name: "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.chain.robinhood.com"] } },
  blockExplorers: { default: { name: "Explorer", url: "https://explorer.testnet.chain.robinhood.com" } },
  testnet: true,
});

/** Local anvil (31337) started by script/local-demo.sh. Mocks only, no real funds. */
export const robinhoodLocal = defineChain({
  id: 31337,
  name: "Local anvil (Amen demo)",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } },
  testnet: true,
});

export type AmenNetwork = "local" | "testnet" | "mainnet";

export const network: AmenNetwork = ((process.env.NEXT_PUBLIC_AMEN_CHAIN as AmenNetwork) || "local");

const base: Chain = network === "mainnet" ? robinhood : network === "testnet" ? robinhoodTestnet : robinhoodLocal;

/** Accepts a bare host ("my-chain.up.railway.app") as well as a full URL; strips a trailing slash. */
function normalizeRpcUrl(raw: string | undefined): string | undefined {
  const v = raw?.trim().replace(/\/+$/, "");
  if (!v) return undefined;
  if (/^https?:\/\//i.test(v)) return v;
  const local = /^(localhost|127\.0\.0\.1)(:|$)/i.test(v);
  return `${local ? "http" : "https"}://${v}`;
}

const rpcOverride = normalizeRpcUrl(process.env.NEXT_PUBLIC_RPC_URL);

export const activeChain: Chain = rpcOverride
  ? { ...base, rpcUrls: { default: { http: [rpcOverride] } } }
  : base;

export const isLocal = network === "local";
