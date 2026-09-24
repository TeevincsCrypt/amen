// Demo-chain actions shared by the 12-step demo and the freeze screen. Local/demo chain only:
// transactions are sent as anvil's unlocked dev accounts and time is moved with anvil RPCs.
import { createWalletClient, http, type Abi, type Address, type PublicClient } from "viem";
import { activeChain } from "./chains";
import { ACCOUNTS, DEMO } from "./demo";
import { amenOracleAbi, mockAggregatorAbi, mockSwapAdapterAbi, stockTokenAbi } from "./contracts";

export type Who = keyof typeof ACCOUNTS;
export type DemoCall = { address: Address; abi: Abi | readonly unknown[]; functionName: string; args?: readonly unknown[] };

const wallet = createWalletClient({ chain: activeChain, transport: http(activeChain.rpcUrls.default.http[0]) });

export async function demoRpc(method: string, params: unknown[] = []) {
  const res = await fetch(activeChain.rpcUrls.default.http[0], {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
  });
  const j = await res.json();
  if (j.error) throw new Error(j.error.message);
  return j.result;
}

/** Send calls in order as a demo account, waiting for each receipt. Throws on revert. */
export async function demoSend(client: PublicClient, who: Who, calls: DemoCall[]) {
  for (const c of calls) {
    const hash = await wallet.writeContract({ ...(c as object), account: ACCOUNTS[who], chain: activeChain } as never);
    const rc = await client.waitForTransactionReceipt({ hash });
    if (rc.status !== "success") throw new Error(`${c.functionName} reverted`);
  }
}

/**
 * Monday's first print for each demo ticker (8 decimals), the same values script/local-demo.sh
 * uses. NVDA's $182.00 is +1.11% on the $180 close, so the demo's NVDA market resolves YES.
 */
export const OPEN_PRINTS: Record<string, bigint> = {
  NVDA: 18_200_000_000n,
  AAPL: 23_290_000_000n,
  SPY: 66_120_000_000n,
  TSLA: 40_262_000_000n,
  MSFT: 51_150_000_000n,
};

/**
 * Step 8 and the freeze screen: every listed mock feed publishes a new round, and the mock swap
 * venue moves to NVDA's price. A ticker without a scripted price re-publishes its last answer,
 * which is still a fresh round.
 */
export async function demoPrintOpen(client: PublicClient) {
  const stocks = await client.readContract({ address: DEMO.oracle, abi: amenOracleAbi, functionName: "allStocks" });
  const calls: DemoCall[] = [];
  for (const stock of stocks) {
    const [symbol, feed] = await Promise.all([
      client.readContract({ address: stock, abi: stockTokenAbi, functionName: "symbol" }),
      client.readContract({ address: DEMO.oracle, abi: amenOracleAbi, functionName: "feedOf", args: [stock] }),
    ]);
    const px = OPEN_PRINTS[symbol] ?? (await client.readContract({ address: feed, abi: mockAggregatorAbi, functionName: "latestRoundData" }))[1];
    calls.push({ address: feed, abi: mockAggregatorAbi, functionName: "setAnswer", args: [px] });
  }
  calls.push({ address: DEMO.mockVenue, abi: mockSwapAdapterAbi, functionName: "setPrice", args: [182n * 10n ** 18n] });
  await demoSend(client, "owner", calls);
}

/**
 * Revert to the latest Friday-16:02 snapshot, then take a fresh one for next time.
 * Only Friday-state snapshots are kept on the demo chain (by the script and by this action),
 * and each is the newest when taken. A probe snapshot reveals the current id N, so the Friday
 * snapshot is N−1. Never try an older, unknown id: on anvil a revert to a missing id still
 * deletes every newer snapshot, which would destroy the Friday state for everyone.
 */
export async function demoRewind(client: PublicClient) {
  const probe = BigInt(await demoRpc("evm_snapshot"));
  let ok = false;
  for (let id = probe - 1n; id >= 0n && id >= probe - 8n && !ok; id--) {
    ok = await demoRpc("evm_revert", [`0x${id.toString(16)}`]);
  }
  if (!ok) throw new Error("no Friday snapshot left on this chain: restart the demo chain");
  const latest = await client.getBlock();
  await demoRpc("evm_setNextBlockTimestamp", [Number(latest.timestamp) + 1]);
  await demoRpc("evm_mine");
  await demoRpc("evm_snapshot");
}
