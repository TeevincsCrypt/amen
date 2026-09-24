// Demo-chain actions shared by the 12-step demo and the freeze screen. Local/demo chain only:
// transactions are sent as anvil's unlocked dev accounts and time is moved with anvil RPCs.
import { createWalletClient, http, type Abi, type Address, type PublicClient } from "viem";
import { activeChain } from "./chains";
import { ACCOUNTS, DEMO } from "./demo";
import { mockAggregatorAbi, mockSwapAdapterAbi } from "./contracts";

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

/** Step 8: the mock NVDA/USD feed prints $182.00 (8 dec) and the mock swap venue moves with it. */
export const PRINT_182: DemoCall[] = [
  { address: DEMO.nvdaFeed, abi: mockAggregatorAbi, functionName: "setAnswer", args: [18_200_000_000n] },
  { address: DEMO.mockVenue, abi: mockSwapAdapterAbi, functionName: "setPrice", args: [182n * 10n ** 18n] },
];

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
