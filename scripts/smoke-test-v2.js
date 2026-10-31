// End-to-end check of stablecoin circles on testnet. Two accounts run a
// 2-member tUSDC circle to the end, paying with tUSDC, tUSDT and NEAR.
// Usage: KEY_A=a.json KEY_B=b.json node smoke-test-v2.js
const { Account, JsonRpcProvider, teraToGas } = require("near-api-js");
const fs = require("fs");

const RPC = process.env.NEAR_RPC || "https://rpc.testnet.near.org";
const AJO = process.env.CONTRACT || "ajo-on-near.testnet";
const USDC = `usdc.${AJO}`;
const USDT = `usdt.${AJO}`;
const AMOUNT = "10000"; // 0.01 tUSDC
const provider = new JsonRpcProvider({ url: RPC });
const load = (f) => {
  const k = JSON.parse(fs.readFileSync(f));
  return new Account(k.account_id, provider, k.private_key);
};
const view = (contractId, method, args = {}) => provider.callFunction({ contractId, method, args });
const call = (acct, contractId, methodName, args, deposit = 1n, gas = "300") =>
  acct.callFunction({ contractId, methodName, args, gas: teraToGas(gas), deposit });
const bal = (t, a) => view(t, "ft_balance_of", { account_id: a.accountId });

const direct = (acct, msg) => call(acct, USDC, "ft_transfer_call", { receiver_id: AJO, amount: AMOUNT, msg: JSON.stringify(msg) });
const viaUsdt = (acct, msg) => call(acct, USDT, "ft_transfer_call", {
  receiver_id: USDC, amount: AMOUNT, msg: JSON.stringify({ receiver_id: AJO, msg: JSON.stringify(msg) }),
});
const viaNear = async (acct, msg) => {
  const near = await view(USDC, "near_for", { amount: AMOUNT });
  return call(acct, USDC, "buy_with_near", { receiver_id: AJO, forward_amount: AMOUNT, msg: JSON.stringify(msg) }, BigInt(near));
};

(async () => {
  const a = load(process.env.KEY_A);
  const b = load(process.env.KEY_B);
  for (const [acct, t] of [[a, USDC], [b, USDT]]) {
    await call(acct, t, "faucet", {}, 0n, "30").catch((e) => console.log("faucet:", e.message?.slice(0, 80)));
  }
  console.log("A tUSDC", await bal(USDC, a), "B tUSDT", await bal(USDT, b));

  const before = await view(AJO, "get_circle_count");
  await direct(a, { action: "create", name: "Stablecoin smoke test", max_members: 2, period_minutes: 5, min_trust_score: null });
  const id = before;
  let c = await view(AJO, "get_circle", { circle_id: id });
  console.log("created", id, c.name, c.token, c.contribution);

  await viaUsdt(b, { action: "join", circle_id: id }); // tUSDT swapped 1:1 into tUSDC on the way
  c = await view(AJO, "get_circle", { circle_id: id });
  console.log("joined; status", c.status, "order", c.members.map((m) => m.account_id));

  // A refused payment must refund: B is already a member.
  const bBefore = await bal(USDC, b);
  await direct(b, { action: "join", circle_id: id }).then(() => console.log("refused join: tx ok"), (e) => console.log("refused join:", e.message?.slice(0, 80)));
  console.log("refund check: B tUSDC before", bBefore, "after", await bal(USDC, b));

  for (let round = 1; round <= 2; round++) {
    await direct(a, { action: "contribute", circle_id: id });
    await viaNear(b, { action: "contribute", circle_id: id }); // NEAR bought into tUSDC on the way
    c = await view(AJO, "get_circle", { circle_id: id });
    const h = c.history[round - 1];
    console.log(`round ${h.round}: ${h.amount} tUSDC units -> ${h.recipient}`);
  }
  console.log("final status", c.status);
  console.log("balances A", await bal(USDC, a), "B", await bal(USDC, b), "contract", await view(USDC, "ft_balance_of", { account_id: AJO }));
  console.log("old circle 1 still there:", (await view(AJO, "get_circle", { circle_id: 1 }))?.name);
})().catch((e) => { console.error(e.message || e); process.exit(1); });
