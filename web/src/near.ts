import { NearConnector } from "@hot-labs/near-connect";

export const CONTRACT_ID = import.meta.env.VITE_CONTRACT_ID || "ajo-on-near.testnet";
export const NETWORK = "testnet" as const;
const RPC = import.meta.env.VITE_RPC || "https://rpc.testnet.near.org";
export const EXPLORER = "https://testnet.nearblocks.io";

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
}

export interface Trust {
  account_id: string;
  circles_completed: number;
  on_time_payments: number;
  missed_payments: number;
  score: number;
}

// ---------------------------------------------------------------- views

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

export async function call(methodName: string, args: object, deposit = "0") {
  const wallet = await connector.wallet();
  return wallet.signAndSendTransaction({
    receiverId: CONTRACT_ID,
    actions: [{ type: "FunctionCall", params: { methodName, args, gas: GAS, deposit } }],
  });
}

// ---------------------------------------------------------------- units

const DECIMALS = 24;

/** "1.5" NEAR -> yoctoNEAR string. */
export function toYocto(near: string): string {
  const clean = near.trim();
  if (!/^\d*\.?\d*$/.test(clean) || clean === "" || clean === ".") throw new Error("Enter an amount like 0.5");
  const [whole, frac = ""] = clean.split(".");
  if (frac.length > DECIMALS) throw new Error("Too many decimal places");
  const yocto = BigInt((whole || "0") + frac.padEnd(DECIMALS, "0"));
  return yocto.toString();
}

/** yoctoNEAR string -> "1.5" NEAR, trimmed. */
export function fromYocto(yocto: string | bigint, maxDecimals = 4): string {
  const s = BigInt(yocto).toString().padStart(DECIMALS + 1, "0");
  const whole = s.slice(0, -DECIMALS);
  let frac = s.slice(-DECIMALS).slice(0, maxDecimals).replace(/0+$/, "");
  return frac ? `${Number(whole).toLocaleString()}.${frac}` : Number(whole).toLocaleString();
}

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
  return raw.length > 200 ? raw.slice(0, 200) + "…" : raw;
}
