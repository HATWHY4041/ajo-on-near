// Version 3 on testnet: the swap desk (pay a NEAR circle with USDC, USDT or wNEAR)
// and the Ajo contract's `pay_for`. No state migration: v3 adds a method only.
// Usage: KEY_FILE=path/to/ajo-on-near.testnet.key.json RESERVE=3 node deploy-v3.js
const { Account, JsonRpcProvider, KeyPair, actions, teraToGas, nearToYocto } = require("near-api-js");
const fs = require("fs");
const path = require("path");

const RPC = process.env.NEAR_RPC || "https://rpc.testnet.near.org";
const CIRCLE_USDC = "3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af";
const WRAP = "wrap.testnet";
const provider = new JsonRpcProvider({ url: RPC });
const exists = (id) => provider.query({ request_type: "view_account", finality: "final", account_id: id }).then(() => true, () => false);
const view = (contractId, method, args = {}) => provider.callFunction({ contractId, method, args });

// yoctoNEAR per smallest token unit at the fixed test rates
const PER_DOLLAR_UNIT = (10n ** 24n / 2_500_000n).toString(); // 1 NEAR = 2.5 USD, 6 decimals

(async () => {
  const key = JSON.parse(fs.readFileSync(process.env.KEY_FILE));
  const owner = new Account(key.account_id, provider, key.private_key);
  const publicKey = KeyPair.fromString(key.private_key).getPublicKey();
  const swapWasm = fs.readFileSync(path.join(__dirname, "../swap/res/ajo_swap_desk.wasm"));
  const ajoWasm = fs.readFileSync(path.join(__dirname, "../contract/res/ajo_on_near.wasm"));
  const swap = `swap.${key.account_id}`;
  const reserve = nearToYocto(process.env.RESERVE || "3");

  if (!(await exists(swap))) {
    const fund = BigInt(swapWasm.length) * 10n ** 19n + nearToYocto("0.6") + reserve;
    console.log(`Creating ${swap} with ${Number(fund) / 1e24} NEAR (reserve ${Number(reserve) / 1e24}) ...`);
    await owner.signAndSendTransaction({
      receiverId: swap,
      actions: [
        actions.createAccount(),
        actions.transfer(fund),
        actions.addFullAccessKey(publicKey),
        actions.deployContract(swapWasm),
        actions.functionCall("new", {
          owner: key.account_id,
          ajo: key.account_id,
          rates: [
            { token: CIRCLE_USDC, symbol: "USDC", decimals: 6, yocto_per_unit: PER_DOLLAR_UNIT },
            { token: `usdt.${key.account_id}`, symbol: "tUSDT", decimals: 6, yocto_per_unit: PER_DOLLAR_UNIT },
            { token: `usdc.${key.account_id}`, symbol: "tUSDC", decimals: 6, yocto_per_unit: PER_DOLLAR_UNIT },
            { token: WRAP, symbol: "wNEAR", decimals: 24, yocto_per_unit: "1" },
          ],
        }, teraToGas("30")),
      ],
    });
  } else {
    console.log(`${swap} exists; updating code only`);
    await new Account(swap, provider, key.private_key).deployContract(swapWasm);
  }

  // The desk must be registered with tokens that use storage registration to receive them.
  const desk = new Account(swap, provider, key.private_key);
  for (const token of [CIRCLE_USDC, WRAP]) {
    const reg = await view(token, "storage_balance_of", { account_id: swap }).catch(() => null);
    if (reg) { console.log(`registered with ${token}`); continue; }
    await desk.callFunction({ contractId: token, methodName: "storage_deposit", args: { account_id: swap, registration_only: true },
      gas: teraToGas("30"), deposit: nearToYocto("0.0125") });
    console.log(`registered ${swap} with ${token}`);
  }

  console.log(`Updating ${key.account_id} code (${ajoWasm.length} bytes) ...`);
  await owner.deployContract(ajoWasm);

  console.log("rates", (await view(swap, "get_rates")).map((r) => r.symbol));
  console.log("reserve NEAR", Number(BigInt(await view(swap, "reserve"))) / 1e24);
  console.log("circles", await view(key.account_id, "get_circle_count"));
})().catch((e) => { console.error(e.message || e); process.exit(1); });
