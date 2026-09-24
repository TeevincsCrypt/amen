import { BaseError, ContractFunctionRevertedError } from "viem";
import { bytes32ToString } from "./format";

const HUMAN: Record<string, string> = {
  VespersInventoryLocked:
    "The vault holds stock inventory during Vespers. Its weekend mark may be stale, so deposits and withdrawals reopen after the next flatten.",
  CashOpenFlattenRequired: "There isn't enough free USDG in the vault yet. The keeper has to flatten the stock inventory first.",
  OracleFrozen: "The oracle is frozen, so this action is paused until the feed is healthy.",
  NotVespers: "Only allowed while US cash is closed (Vespers).",
  CashClosed: "Only allowed while US cash is open.",
  TradingClosed: "Trading on this market has ended.",
  MaxNotionalExceeded: "This would exceed the market's notional cap.",
  TooEarly: "Too early. Resolution opens at the market's resolve time.",
  ResolveWindowOver: "The 60-minute resolve window has passed. This market can now be voided (full refunds).",
  VoidNotYetAllowed: "The void window hasn't started yet (it opens 60 minutes after the resolve time).",
  ResolveRoundNotFound: "No Chainlink round printed during the cash session after the resolve time yet.",
  ResolveRoundInvalid: "That round isn't the first cash-session print after the resolve time.",
  NothingToClaim: "Nothing to claim.",
  AlreadyClaimed: "Already claimed.",
  AlreadySettled: "Market already settled.",
  AlreadyRecorded: "The official close for that session is already recorded.",
  RoundOutsideCloseWindow: "The latest round isn't within 30 minutes before the bell. Record at an explicit round instead.",
  CloseNotRecorded: "Record the official close first.",
  NotKeeper: "Only a keeper or the owner can do this.",
  CashOpen: "Only allowed after the cash close.",
  InventoryCapExceeded: "This would exceed the vault's max inventory (maxInventoryBps).",
  PriceDeviation: "The swap price deviates too far from the oracle mark.",
  NoActiveCycle: "Start a Vespers cycle first.",
  NotFlat: "The vault must be flat (no stock held) for this.",
  CycleActive: "A cycle is already active.",
  WrongChain: "Wrong chain. Amen runs only on Robinhood Chain.",
  ERC4626ExceededMaxDeposit: "The vault's beta deposit cap is reached (or this would exceed it). Try a smaller amount.",
  ERC4626ExceededMaxMint: "The vault's beta deposit cap is reached (or this would exceed it). Try a smaller amount.",
};

export function decodeError(e: unknown): string {
  if (e instanceof BaseError) {
    const reverted = e.walk((err) => err instanceof ContractFunctionRevertedError);
    if (reverted instanceof ContractFunctionRevertedError) {
      const name = reverted.data?.errorName;
      if (name) {
        let extra = "";
        if (name === "OracleFrozen" && reverted.data?.args?.[0]) {
          extra = ` (${bytes32ToString(reverted.data.args[0] as `0x${string}`)})`;
        }
        return `${name}${extra}: ${HUMAN[name] ?? ""}`.trim();
      }
      return reverted.reason ?? reverted.shortMessage;
    }
    return e.shortMessage;
  }
  return e instanceof Error ? e.message : String(e);
}
