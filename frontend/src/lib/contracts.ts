import deployments from "./deployments.json";
import { activeChain } from "./chains";
import type { Address } from "viem";

export type Deployment = {
  chainId: number;
  usdg: Address;
  nvda: Address;
  nvdaFeed: Address;
  oracle: Address;
  vault: Address;
  market: Address;
  swapAdapter: Address;
};

export const deployment: Deployment | undefined = (deployments as Record<string, Deployment>)[String(activeChain.id)];

export { amenOracleAbi, vespersVaultAbi, amenMarketAbi, stockTokenAbi, mockAggregatorAbi, usdgAbi, mockSwapAdapterAbi } from "./abi";
