import { NearConnector } from "@hot-labs/near-connect";

export const CONTRACT_ID = import.meta.env.VITE_CONTRACT_ID || "ajo-on-near.testnet";
export const NETWORK = "testnet" as const;
const RPC = import.meta.env.VITE_RPC || "https://rpc.testnet.near.org";
export const EXPLORER = "https://testnet.nearblocks.io";

// ---------------------------------------------------------------- currencies

export interface Currency {
  id: string | null; // token contract, or null for NEAR
  symbol: string;
  name: string;
  decimals: number;
}

export const USDC_ID = import.meta.env.VITE_USDC_ID || "usdc.ajo-on-near.testnet";
export const USDT_ID = import.meta.env.VITE_USDT_ID || "usdt.ajo-on-near.testnet";

/** Circle's own USDC on NEAR testnet (the same issuer as mainnet USDC). */
export const CIRCLE_USDC_ID = import.meta.env.VITE_CIRCLE_USDC_ID || "3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af";
export const WRAP_ID = import.meta.env.VITE_WRAP_ID || "wrap.testnet";
/** Converts other NEAR tokens to NEAR for circles, at fixed test rates. */
export const SWAP_ID = import.meta.env.VITE_SWAP_ID || "swap.ajo-on-near.testnet";

export const NEAR: Currency = { id: null, symbol: "NEAR", name: "NEAR", decimals: 24 };
export const USDC: Currency = { id: CIRCLE_USDC_ID, symbol: "USDC", name: "USDC by Circle", decimals: 6 };
export const TUSDT: Currency = { id: USDT_ID, symbol: "tUSDT", name: "Test USDT", decimals: 6 };
export const WNEAR: Currency = { id: WRAP_ID, symbol: "wNEAR", name: "Wrapped NEAR", decimals: 24 };
export const TUSDC: Currency = { id: USDC_ID, symbol: "tUSDC", name: "Test USDC", decimals: 6 };
/** What a member can pay a circle with; anything other than NEAR is converted to NEAR. */
export const PAY_OPTIONS = [NEAR, USDC, TUSDT, WNEAR];
const ALL = [NEAR, USDC, TUSDT, WNEAR, TUSDC];
/** Kept for older dollar circles. */
export const CURRENCIES = [TUSDC, TUSDT, NEAR];
/** Fixed test rate: 1 NEAR = this many dollars (USDC, tUSDT, tUSDC). */
export const TEST_RATE = 2.5;

export function currencyOf(token: string | null | undefined): Currency {
  return ALL.find((c) => c.id === (token ?? null)) ?? { id: token ?? null, symbol: token ?? "NEAR", name: token ?? "NEAR", decimals: 24 };
}

/** Amount in a circle's currency, e.g. "10 tUSDC". */
export function money(amount: string | bigint, token: string | null | undefined, maxDecimals = 4): string {
  const cur = currencyOf(token);
  return `${fromUnits(amount, cur.decimals, maxDecimals)} ${cur.symbol}`;
}

// ---------------------------------------------------------------- types

export type Status = "Open" | "Active" | "Completed";

export interface Member {
  account_id: string;
  deposit_left: string;
  paid_this_round: boolean;
  on_time_payments: number;
  missed_payments: number;
  received_payout: boolean;
}

export interface RoundRecord {
  round: number;
  recipient: string;
  amount: string;
  missed_by: string[];
  paid_at_ms: number;
}

export interface Circle {
  id: number;
  name: string;
  creator: string;
  contribution: string;
  deposit: string;
  max_members: number;
  period_minutes: number;
  min_trust_score: number;
  members: Member[];
  status: Status;
  current_round: number;
  round_deadline_ms: number;
  pot: string;
  history: RoundRecord[];
  created_at_ms: number;
  /** NEP-141 token the circle runs in; null = NEAR. */
  token?: string | null;
}

export interface Trust {
  account_id: string;
  circles_completed: number;
  on_time_payments: number;
  missed_payments: number;
  score: number;
}

// ---------------------------------------------------------------- views

async function rpc(params: object) {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "ajo", method: "query", params }),
  });
  return res.json();
}

/** Read-only call on any testnet contract. */
export async function viewOn<T>(contract: string, method: string, args: object = {}): Promise<T> {
  const json = await rpc({
    request_type: "call_function", finality: "optimistic", account_id: contract,
    method_name: method, args_base64: btoa(JSON.stringify(args)),
  });
  if (json.error || json.result?.error) throw new Error(json.error?.data || json.result?.error || "Could not reach NEAR testnet");
  return JSON.parse(new TextDecoder().decode(new Uint8Array(json.result.result)));
}

/** Balance of `account` in a currency, in its smallest unit. */
export async function balanceOf(cur: Currency, account: string): Promise<string> {
  if (cur.id) return viewOn<string>(cur.id, "ft_balance_of", { account_id: account });
  const json = await rpc({ request_type: "view_account", finality: "optimistic", account_id: account });
  return json.result?.amount ?? "0";
}

async function view<T>(method: string, args: object = {}): Promise<T> {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "ajo",
      method: "query",
      params: {
        request_type: "call_function",
        finality: "optimistic",
        account_id: CONTRACT_ID,
        method_name: method,
        args_base64: btoa(JSON.stringify(args)),
      },
    }),
  });
  const json = await res.json();
  if (json.error || json.result?.error) {
    throw new Error(json.error?.data || json.result?.error || "Could not reach NEAR testnet");
  }
  return JSON.parse(new TextDecoder().decode(new Uint8Array(json.result.result)));
}

export const getCircles = () => view<Circle[]>("get_circles", { from_index: 0, limit: 100 });
export const getCircle = (id: number) => view<Circle | null>("get_circle", { circle_id: id });
export const getTrust = (account_id: string) => view<Trust>("get_trust", { account_id });

// ---------------------------------------------------------------- wallet

export const connector = new NearConnector({ network: NETWORK, autoConnect: true });

const GAS = "100000000000000"; // 100 Tgas

const GAS_MAX = "300000000000000"; // 300 Tgas, for token payments that may pay out the pot

export async function call(methodName: string, args: object, deposit = "0", receiverId = CONTRACT_ID, gas = GAS) {
  return callMany(receiverId, [{ methodName, args, deposit, gas }]);
}

/** Several function calls to one contract, signed once. */
export async function callMany(receiverId: string, calls: { methodName: string; args: object; deposit: string; gas?: string }[]) {
  const wallet = await connector.wallet();
  const outcome = await wallet.signAndSendTransaction({
    receiverId,
    actions: calls.map(({ methodName, args, deposit, gas = GAS }) => ({ type: "FunctionCall" as const, params: { methodName, args, gas, deposit } })),
  });
  // A token payment the circle refuses still "succeeds" as a transaction (the
  // tokens are refunded), so look for the circle's reason in the receipts.
  const failed = JSON.stringify(outcome ?? "").match(/Smart contract panicked: ([^"\\]+)/);
  if (failed) throw new Error(`${failed[1].trim()} Your tokens were returned.`);
  return outcome;
}

export type FtAction =
  | { action: "create"; name: string; max_members: number; period_minutes: number; min_trust_score: number | null }
  | { action: "join"; circle_id: number }
  | { action: "contribute"; circle_id: number };

const NEAR_METHOD = { join: "join_circle", contribute: "contribute" } as const;

/**
 * Pay `amount` into a circle for create / join / contribute, in one transaction.
 * NEAR circles take NEAR. Stablecoin circles take their own token directly, the
 * other test stablecoin (swapped 1:1 on the way), or NEAR (bought at the fixed
 * test rate on the way).
 */
export async function payIn(circleToken: string | null, payWith: Currency, amount: string, act: FtAction) {
  if (!circleToken) {
    if (payWith.id) {
      // Another NEAR token: the swap desk converts it to exactly `amount` NEAR and pays the circle for you.
      const tokens = await viewOn<string>(SWAP_ID, "quote", { token: payWith.id, near_amount: amount });
      return call("ft_transfer_call", {
        receiver_id: SWAP_ID, amount: tokens, msg: JSON.stringify({ near_amount: amount, action: act }),
      }, "1", payWith.id, GAS_MAX);
    }
    if (act.action === "create") {
      const { action: _a, ...rest } = act;
      return call("create_circle", { ...rest, contribution: amount }, amount);
    }
    return call(NEAR_METHOD[act.action], { circle_id: act.circle_id }, amount);
  }
  const msg = JSON.stringify(act);
  if (payWith.id === circleToken) {
    return call("ft_transfer_call", { receiver_id: CONTRACT_ID, amount, msg }, "1", circleToken, GAS_MAX);
  }
  if (payWith.id) {
    // Swap the partner test stablecoin into the circle's token, then forward it to the circle.
    return call("ft_transfer_call", {
      receiver_id: circleToken, amount, msg: JSON.stringify({ receiver_id: CONTRACT_ID, msg }),
    }, "1", payWith.id, GAS_MAX);
  }
  const near = await viewOn<string>(circleToken, "near_for", { amount });
  return call("buy_with_near", { receiver_id: CONTRACT_ID, forward_amount: amount, msg }, near, circleToken, GAS_MAX);
}

/** What paying `amount` of a circle's token costs in another currency. */
export async function costIn(circleToken: string | null, payWith: Currency, amount: string): Promise<string> {
  if (!circleToken) return payWith.id ? viewOn<string>(SWAP_ID, "quote", { token: payWith.id, near_amount: amount }) : amount;
  if (payWith.id) return amount;
  return viewOn<string>(circleToken, "near_for", { amount });
}

export const faucet = (token: string) => call("faucet", {}, "0", token, "30000000000000");

/** Wrap 1 NEAR into wNEAR (registers the account with wrap.testnet first). */
export const wrapNear = () => callMany(WRAP_ID, [
  { methodName: "storage_deposit", args: { registration_only: true }, deposit: "1250000000000000000000", gas: "30000000000000" },
  { methodName: "near_deposit", args: {}, deposit: "1000000000000000000000000", gas: "30000000000000" },
]);

// ---------------------------------------------------------------- units

/** "1.5" -> smallest units for a token with `decimals`. */
export function toUnits(value: string, decimals: number): string {
  const clean = value.trim();
  if (!/^\d*\.?\d*$/.test(clean) || clean === "" || clean === ".") throw new Error("Enter an amount like 0.5");
  const [whole, frac = ""] = clean.split(".");
  if (frac.length > decimals) throw new Error(`At most ${decimals} decimal places`);
  return BigInt((whole || "0") + frac.padEnd(decimals, "0")).toString();
}

/** Smallest units -> "1.5", trimmed. */
export function fromUnits(units: string | bigint, decimals: number, maxDecimals = 4): string {
  const s = BigInt(units).toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, -decimals);
  const frac = s.slice(-decimals).slice(0, maxDecimals).replace(/0+$/, "");
  return frac ? `${Number(whole).toLocaleString()}.${frac}` : Number(whole).toLocaleString();
}

export const toYocto = (near: string) => toUnits(near, 24);
export const fromYocto = (yocto: string | bigint, maxDecimals = 4) => fromUnits(yocto, 24, maxDecimals);

export const times = (yocto: string, n: number) => (BigInt(yocto) * BigInt(n)).toString();

// ---------------------------------------------------------------- labels

export function shortAccount(id: string): string {
  if (id.length === 64 && /^[0-9a-f]+$/.test(id)) return `${id.slice(0, 6)}…${id.slice(-4)}`;
  return id.length > 22 ? `${id.slice(0, 19)}…` : id;
}

export function initials(id: string): string {
  const base = id.replace(/\.(testnet|near)$/, "").replace(/[^a-z0-9]/gi, " ").trim();
  const parts = base.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return base.slice(0, 2).toUpperCase();
}

export function periodLabel(minutes: number): string {
  if (minutes % 10080 === 0) return minutes === 10080 ? "every week" : `every ${minutes / 10080} weeks`;
  if (minutes % 1440 === 0) return minutes === 1440 ? "every day" : `every ${minutes / 1440} days`;
  if (minutes % 60 === 0) return minutes === 60 ? "every hour" : `every ${minutes / 60} hours`;
  return minutes === 1 ? "every minute" : `every ${minutes} minutes`;
}

export function timeLeft(deadlineMs: number, now: number): string {
  const ms = deadlineMs - now;
  if (ms <= 0) return "Deadline passed";
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  if (m >= 2880) return `${Math.floor(m / 1440)} days left`;
  if (m >= 120) return `${Math.floor(m / 60)} hours left`;
  if (m >= 1) return `${m} min ${s.toString().padStart(2, "0")} s left`;
  return `${s} s left`;
}

/** Turn wallet / contract errors into a sentence a member can act on. */
export function explainError(e: unknown): string {
  const raw = e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e);
  const smart = raw.match(/Smart contract panicked: ([^"\\]+)/);
  if (smart) return smart[1].trim();
  if (/reject|cancel|closed/i.test(raw)) return "You closed the wallet before approving. Nothing was sent.";
  if (/NotEnoughBalance|insufficient/i.test(raw)) return "Your wallet doesn't have enough test NEAR for this.";
  if (/enough balance/i.test(raw)) return "You don't have enough of that test token. Use the Get test tokens button first.";
  if (/Faucet used/i.test(raw)) return "You already used the faucet in the last hour. Try again later, or pay with NEAR.";
  return raw.length > 200 ? raw.slice(0, 200) + "…" : raw;
}
