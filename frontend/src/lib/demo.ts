// Local anvil demo constants. Addresses are hardcoded from deployments/31337.json: they're
// deterministic for a fresh anvil (default mnemonic, deployer = account #0). Local only.
import type { Address } from "viem";

export const DEMO = {
  chainId: 31337,
  usdg: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
  nvda: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
  nvdaFeed: "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0",
  mockVenue: "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9",
  oracle: "0x5FC8d32690cc91D4c39d9d3abcBD16989F875707",
  vault: "0xa513E6E4b8f2a923D98304ec87F64353C4D5C853",
  market: "0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6",
} as const satisfies Record<string, Address | number>;

/** anvil dev accounts #0..#2 (unlocked on anvil, so the page can send as them without a wallet). */
export const ACCOUNTS = {
  owner: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
  user1: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  user2: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
} as const satisfies Record<string, Address>;

export const T = {
  vespers: 1790366460, // Fri 2026-09-25 16:01 New York
  mondayOpen: 1790602200, // Mon 2026-09-28 09:30 New York
  monday: 1790603100, // Mon 2026-09-28 09:45 New York
};

export const SESSION_ID = 20721n; // Fri 2026-09-25 (UTC day index)
export const MARKET_ID = 1n;
