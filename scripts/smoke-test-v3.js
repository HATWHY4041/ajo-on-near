// End-to-end check of paying a NEAR circle with other tokens through the swap desk.
// A pays with test USDT, B with wNEAR; both are converted to NEAR on the way.
// Usage: KEY_A=a.json KEY_B=b.json node smoke-test-v3.js
const { Account, JsonRpcProvider, teraToGas, nearToYocto, actions } = require("near-api-js");
const fs = require("fs");

const RPC = process.env.NEAR_RPC || "https://rpc.testnet.near.org";
const AJO = process.env.CONTRACT || "ajo-on-near.testnet";
const SWAP = `swap.${AJO}`;
const USDT = `usdt.${AJO}`;
const WRAP = "wrap.testnet";
const NEAR_AMOUNT = nearToYocto("0.01").toString();
const provider = new JsonRpcProvider({ url: RPC });
const load = (f) => { const k = JSON.parse(fs.readFileSync(f)); return new Account(k.account_id, provider, k.private_key); };
const view = (contractId, method, args = {}) => provider.callFunction({ contractId, method, args });
const near = async (a) => Number(BigInt((await provider.query({ request_type: "view_account", finality: "final", account_id: a.accountId })).amount)) / 1e24;

async function payWith(acct, token, action) {
  const amount = await view(SWAP, "quote", { token, near_amount: NEAR_AMOUNT });
  const r = await acct.signAndSendTransaction({
    receiverId: token, throwOnFailure: false,
    actions: [actions.functionCall("ft_transfer_call", {
      receiver_id: SWAP, amount, msg: JSON.stringify({ near_amount: NEAR_AMOUNT, action }),
    }, teraToGas("300"), 1n)],
  });
  const failed = JSON.stringify(r).match(/Smart contract panicked: ([^"\\]+)/);
  return { amount, failed: failed && failed[1] };
}

(async () => {
  const a = load(process.env.KEY_A);
  const b = load(process.env.KEY_B);
  await a.callFunction({ contractId: USDT, methodName: "faucet", args: {}, gas: teraToGas("30") }).catch((e) => console.log("faucet:", e.message?.slice(0, 60)));
  await b.signAndSendTransaction({ receiverId: WRAP, actions: [
    actions.functionCall("storage_deposit", { registration_only: true }, teraToGas("30"), nearToYocto("0.00125")),
    actions.functionCall("near_deposit", {}, teraToGas("30"), nearToYocto("0.05")),
  ] });
  console.log("A tUSDT", await view(USDT, "ft_balance_of", { account_id: a.accountId }), "B wNEAR", await view(WRAP, "ft_balance_of", { account_id: b.accountId }));
  console.log("quote for 0.01 NEAR: tUSDT", await view(SWAP, "quote", { token: USDT, near_amount: NEAR_AMOUNT }), "wNEAR", await view(SWAP, "quote", { token: WRAP, near_amount: NEAR_AMOUNT }));

  const id = await view(AJO, "get_circle_count");
  let r = await payWith(a, USDT, { action: "create", name: "Paid with any token", max_members: 2, period_minutes: 5, min_trust_score: null });
  let c = await view(AJO, "get_circle", { circle_id: id });
  console.log("create via tUSDT:", r.failed || "ok", "->", c && [c.name, c.token, c.contribution, c.creator]);

  r = await payWith(b, WRAP, { action: "join", circle_id: id });
  c = await view(AJO, "get_circle", { circle_id: id });
  console.log("join via wNEAR:", r.failed || "ok", "-> status", c.status, c.members.map((m) => m.account_id));

  const wBefore = await view(WRAP, "ft_balance_of", { account_id: b.accountId });
  r = await payWith(b, WRAP, { action: "join", circle_id: id });
  console.log("refused join:", r.failed, "| B wNEAR before", wBefore, "after", await view(WRAP, "ft_balance_of", { account_id: b.accountId }));

  for (let round = 1; round <= 2; round++) {
    const nb = await near(c.members[round - 1].account_id === a.accountId ? a : b);
    r = await payWith(a, USDT, { action: "contribute", circle_id: id });
    const r2 = await payWith(b, WRAP, { action: "contribute", circle_id: id });
    c = await view(AJO, "get_circle", { circle_id: id });
    const h = c.history[round - 1];
    console.log(`round ${round}: A ${r.failed || "ok"}, B ${r2.failed || "ok"} -> ${h && Number(BigInt(h.amount)) / 1e24} NEAR to ${h && h.recipient} (recipient NEAR before ${nb.toFixed(4)})`);
  }
  console.log("final", c.status, "| desk reserve", Number(BigInt(await view(SWAP, "reserve"))) / 1e24);
})().catch((e) => { console.error(e.message || e); process.exit(1); });
