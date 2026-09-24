"use client";

import { useEffect, useState, useCallback } from "react";
import { useBlock, useReadContract, useReadContracts, useWriteContract, usePublicClient, useAccount } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import type { Address, Hash } from "viem";
import { amenMarketAbi, amenOracleAbi, deployment, stockTokenAbi } from "./contracts";
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

export type StockMark = {
  priceUsd: bigint;
  updatedAt: bigint;
  roundId: bigint;
  cashOpen: boolean;
  frozen: boolean;
  freezeReason: string;
};
export type Stock = { token: Address; symbol: string; allowed: boolean; mark?: StockMark };

/**
 * Every Stock Token listed on the oracle (discovered on-chain, so new listings appear without
 * redeploying the site), with its symbol, market access and live mark.
 */
export function useStocks(): { stocks: Stock[]; loaded: boolean } {
  const enabled = !!deployment;
  const { data: list } = useReadContract({
    address: deployment?.oracle,
    abi: amenOracleAbi,
    functionName: "allStocks",
    query: { enabled, refetchInterval: 30_000 },
  });
  const tokens = (list ?? []) as readonly Address[];
  const { data } = useReadContracts({
    contracts: tokens.flatMap((t) => [
      { address: t, abi: stockTokenAbi, functionName: "symbol" as const },
      { address: deployment!.oracle, abi: amenOracleAbi, functionName: "getMark" as const, args: [t] as const },
      { address: deployment!.market, abi: amenMarketAbi, functionName: "stockAllowed" as const, args: [t] as const },
    ]),
    query: { enabled: enabled && tokens.length > 0, refetchInterval: POLL },
  });
  const stocks: Stock[] = tokens.map((token, i) => {
    const sym = data?.[i * 3]?.result as string | undefined;
    const m = data?.[i * 3 + 1]?.result as
      | { priceUsd: bigint; updatedAt: bigint; roundId: bigint; cashOpen: boolean; frozen: boolean; freezeReason: `0x${string}` }
      | undefined;
    const allowed = data?.[i * 3 + 2]?.result as boolean | undefined;
    return {
      token,
      symbol: sym ?? `${token.slice(0, 6)}…`,
      allowed: allowed ?? true,
      mark: m ? { ...m, freezeReason: bytes32ToString(m.freezeReason) } : undefined,
    };
  });
  return { stocks, loaded: list !== undefined && (tokens.length === 0 || data !== undefined) };
}

/** Symbol + mark for one Stock Token (from the shared list). */
export function useStock(token: Address | undefined): Stock | undefined {
  const { stocks } = useStocks();
  return token ? stocks.find((s) => s.token.toLowerCase() === token.toLowerCase()) : undefined;
}

export type SessionView = {
  loaded: boolean;
  cashOpen: boolean;
  vespers: boolean;
  manualFreeze: boolean;
  nextOpen?: bigint;
  nextClose?: bigint;
  /** Protocol-wide freeze: the owner's manual freeze, or every listed ticker frozen at once. */
  frozen: boolean;
  freezeReason: string;
  state: "CASH OPEN" | "VESPERS" | "FROZEN" | "UNKNOWN";
  stocks: Stock[];
};

export function useSession(): SessionView {
  const enabled = !!deployment;
  const { data: ss } = useReadContract({
    address: deployment?.oracle,
    abi: amenOracleAbi,
    functionName: "sessionState",
    query: { enabled, refetchInterval: POLL },
  });
  const { stocks, loaded } = useStocks();
  const marks = stocks.map((s) => s.mark).filter((m): m is StockMark => !!m);
  const manual = !!ss?.[2];
  const allFrozen = marks.length > 0 && marks.length === stocks.length && marks.every((m) => m.frozen);
  const frozen = manual || allFrozen;
  const cashOpen = !!ss?.[0];
  return {
    loaded: !!ss && loaded,
    cashOpen,
    vespers: !!ss?.[1],
    manualFreeze: manual,
    nextOpen: ss?.[3],
    nextClose: ss?.[4],
    frozen,
    freezeReason: manual ? "MANUAL" : allFrozen ? marks[0].freezeReason : "",
    state: !ss ? "UNKNOWN" : frozen ? "FROZEN" : cashOpen ? "CASH OPEN" : "VESPERS",
    stocks,
  };
}

export type TxState = { status: "idle" | "signing" | "mining" | "done" | "error"; message?: string; hash?: Hash };

/** Send a write, wait for the receipt, refresh all reads, and decode custom errors into plain language. */
export function useTx() {
  const { writeContractAsync } = useWriteContract();
  const client = usePublicClient();
  const { address } = useAccount();
  const qc = useQueryClient();
  const [state, setState] = useState<TxState>({ status: "idle" });

  const send = useCallback(
    async (label: string, req: Parameters<typeof writeContractAsync>[0]): Promise<boolean> => {
      try {
        // Simulate first: a call that would revert is explained here, and the wallet is never
        // asked to sign (and spend gas on) a transaction that can't succeed.
        setState({ status: "signing", message: `${label}: checking…` });
        await client!.simulateContract({ ...(req as object), account: address } as Parameters<NonNullable<typeof client>["simulateContract"]>[0]);
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
    [writeContractAsync, client, qc, address],
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

/** Last `n` Chainlink rounds for one stock via the oracle (price normalized to 18 dec). */
export function useRoundHistory(stock: Address | undefined, n = 48): { points: RoundPoint[]; loaded: boolean } {
  const enabled = !!deployment && !!stock;
  const { data: latest } = useReadContract({
    address: deployment?.oracle,
    abi: amenOracleAbi,
    functionName: "latestRoundId",
    args: stock ? [stock] : undefined,
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
      args: [stock!, id] as const,
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
