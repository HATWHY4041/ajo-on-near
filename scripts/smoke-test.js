// End-to-end check on testnet: two accounts run a 2-member circle to the end.
// Usage: CONTRACT=ajo-on-near.testnet KEY_A=a.json KEY_B=b.json node smoke-test.js
const { Account, JsonRpcProvider, teraToGas, nearToYocto } = require("near-api-js");
const fs = require("fs");

const RPC = process.env.NEAR_RPC || "https://rpc.testnet.near.org";
const CONTRACT = process.env.CONTRACT || "ajo-on-near.testnet";
const AMOUNT = nearToYocto("0.01");
const provider = new JsonRpcProvider({ url: RPC });
const load = (f) => {
  const k = JSON.parse(fs.readFileSync(f));
  return new Account(k.account_id, provider, k.private_key);
};
const call = (acct, methodName, args, deposit = 0n) =>
  acct.callFunction({ contractId: CONTRACT, methodName, args, gas: teraToGas("100"), deposit });
const view = (method, args) => provider.callFunction({ contractId: CONTRACT, method, args });

(async () => {
  const a = load(process.env.KEY_A);
  const b = load(process.env.KEY_B);

  const id = await call(a, "create_circle", {
    name: "Smoke test", contribution: AMOUNT.toString(), max_members: 2, period_minutes: 5,
  }, AMOUNT);
  console.log("created circle", id);
  await call(b, "join_circle", { circle_id: id }, AMOUNT);
  let c = await view("get_circle", { circle_id: id });
  console.log("status", c.status, "order", c.members.map((m) => m.account_id));

  for (let round = 1; round <= 2; round++) {
    await call(a, "contribute", { circle_id: id }, AMOUNT);
    await call(b, "contribute", { circle_id: id }, AMOUNT);
    c = await view("get_circle", { circle_id: id });
    const h = c.history[round - 1];
    console.log(`round ${h.round}: ${h.amount} yocto -> ${h.recipient}`);
  }
  console.log("final status", c.status);
  console.log("trust A", await view("get_trust", { account_id: a.accountId }));
})().catch((e) => { console.error(e.message || e); process.exit(1); });
