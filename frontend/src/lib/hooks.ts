"use client";

import { useEffect, useState, useCallback } from "react";
import { useBlock, useReadContract, useReadContracts, useWriteContract, usePublicClient, useAccount } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import type { Hash } from "viem";
import { amenOracleAbi, deployment } from "./contracts";
import { bytes32ToString } from "./format";
import { decodeError } from "./errors";

const POLL = 4_000;

/** Chain time (block.timestamp of the latest block) advanced locally each second.
 *  We use chain time rather than wall-clock because a local fork can be warped. */
export function useChainNow(): number | undefined {
  const { data: block } = useBlock({ watch: true, query: { refetchInterval: POLL } });
  const [now, setNow] = useState<number | undefined>(undefined);
  useEffect(() => {
    if (!block) return;
    const base = Number(block.timestamp);
    const fetchedAt = Date.now();
    setNow(base);
    const t = setInterval(() => setNow(base + Math.floor((Date.now() - fetchedAt) / 1000)), 1000);
    return () => clearInterval(t);
  }, [block]);
  return now;
}

export type SessionView = {
  loaded: boolean;
  cashOpen: boolean;
  vespers: boolean;
  manualFreeze: boolean;
  nextOpen?: bigint;
  nextClose?: bigint;
  markPrice?: bigint;
  markUpdatedAt?: bigint;
  markRoundId?: bigint;
  frozen: boolean;
  freezeReason: string;
  state: "CASH OPEN" | "VESPERS" | "FROZEN" | "UNKNOWN";
};

export function useSession(): SessionView {
  const enabled = !!deployment;
  const { data } = useReadContracts({
    contracts: enabled
      ? [
          { address: deployment!.oracle, abi: amenOracleAbi, functionName: "sessionState" },
          { address: deployment!.oracle, abi: amenOracleAbi, functionName: "getMark", args: [deployment!.nvda] },
        ]
      : [],
    query: { enabled, refetchInterval: POLL },
  });
  const ss = data?.[0]?.result as readonly [boolean, boolean, boolean, bigint, bigint] | undefined;
  const mark = data?.[1]?.result as
    | { priceUsd: bigint; updatedAt: bigint; roundId: bigint; cashOpen: boolean; frozen: boolean; freezeReason: `0x${string}` }
    | undefined;
  const frozen = !!mark?.frozen || !!ss?.[2];
  const cashOpen = !!ss?.[0];
  return {
    loaded: !!ss && !!mark,
    cashOpen,
    vespers: !!ss?.[1],
    manualFreeze: !!ss?.[2],
    nextOpen: ss?.[3],
    nextClose: ss?.[4],
    markPrice: mark?.priceUsd,
    markUpdatedAt: mark?.updatedAt,
    markRoundId: mark?.roundId,
    frozen,
    freezeReason: mark ? bytes32ToString(mark.freezeReason) || (ss?.[2] ? "MANUAL" : "") : "",
    state: !ss || !mark ? "UNKNOWN" : frozen ? "FROZEN" : cashOpen ? "CASH OPEN" : "VESPERS",
  };
}

export type TxState = { status: "idle" | "signing" | "mining" | "done" | "error"; message?: string; hash?: Hash };

/** Send a write, wait for the receipt, refresh all reads, and decode custom errors into plain language. */
export function useTx() {
  const { writeContractAsync } = useWriteContract();
  const client = usePublicClient();
  const qc = useQueryClient();
  const [state, setState] = useState<TxState>({ status: "idle" });

  const send = useCallback(
    async (label: string, req: Parameters<typeof writeContractAsync>[0]): Promise<boolean> => {
      try {
        setState({ status: "signing", message: `${label}: confirm in wallet…` });
        const hash = await writeContractAsync(req);
        setState({ status: "mining", message: `${label}: waiting for block…`, hash });
        const r = await client!.waitForTransactionReceipt({ hash });
        if (r.status !== "success") throw new Error(`${label} reverted`);
        setState({ status: "done", message: `${label}: confirmed`, hash });
        await qc.invalidateQueries();
        return true;
      } catch (e) {
        setState({ status: "error", message: decodeError(e) });
        return false;
      }
    },
    [writeContractAsync, client, qc],
  );

  return { state, send, busy: state.status === "signing" || state.status === "mining" };
}

/** Owner / keeper flags for the connected account on a given Amen contract. */
export function useRoles(address: `0x${string}` | undefined, abi: typeof amenOracleAbi | readonly unknown[]) {
  const { address: me } = useAccount();
  const enabled = !!address && !!me;
  const { data: owner } = useReadContract({
    address,
    abi: abi as typeof amenOracleAbi,
    functionName: "owner",
    query: { enabled, refetchInterval: 15_000 },
  });
  const { data: keeper } = useReadContract({
    address,
    abi: abi as typeof amenOracleAbi,
    functionName: "isKeeper",
    args: me ? [me] : undefined,
    query: { enabled, refetchInterval: 15_000 },
  });
  const isOwner = !!me && !!owner && (owner as string).toLowerCase() === me.toLowerCase();
  return { isOwner, isKeeper: !!keeper, canOperate: isOwner || !!keeper };
}

/** Latest block timestamp (bigint), refreshed with new blocks. Stable enough to use as a read argument. */
export function useBlockTs(): bigint | undefined {
  const { data: block } = useBlock({ watch: true, query: { refetchInterval: POLL } });
  return block?.timestamp;
}

export type RoundPoint = { roundId: bigint; ts: number; price: bigint };

/** Last `n` Chainlink rounds for NVDA via the oracle (price normalized to 18 dec). */
export function useRoundHistory(n = 48): { points: RoundPoint[]; loaded: boolean } {
  const enabled = !!deployment;
  const { data: latest } = useReadContract({
    address: deployment?.oracle,
    abi: amenOracleAbi,
    functionName: "latestRoundId",
    args: deployment ? [deployment.nvda] : undefined,
    query: { enabled, refetchInterval: POLL },
  });
  const ids: bigint[] = [];
  if (latest && latest > 0n) {
    const first = latest > BigInt(n) ? latest - BigInt(n) + 1n : 1n;
    for (let id = first; id <= latest; id++) ids.push(id);
  }
  const { data } = useReadContracts({
    contracts: ids.map((id) => ({
      address: deployment!.oracle,
      abi: amenOracleAbi,
      functionName: "getRoundMark" as const,
      args: [deployment!.nvda, id] as const,
    })),
    query: { enabled: enabled && ids.length > 0, refetchInterval: POLL * 2 },
  });
  const points: RoundPoint[] = [];
  data?.forEach((d, i) => {
    const r = d?.result as readonly [boolean, bigint, bigint] | undefined;
    if (r && r[0]) points.push({ roundId: ids[i], price: r[1], ts: Number(r[2]) });
  });
  return { points, loaded: latest !== undefined };
}
