// Version 2 on testnet: deploy the two test stablecoins and upgrade the Ajo
// contract in place (migrate keeps every existing circle and trust record).
// Usage: KEY_FILE=path/to/ajo-on-near.testnet.key.json node deploy-v2.js
// The key file is {"account_id": "...", "private_key": "ed25519:..."} and is never committed.
const { Account, JsonRpcProvider, KeyPair, actions, teraToGas, nearToYocto } = require("near-api-js");
const fs = require("fs");
const path = require("path");

const RPC = process.env.NEAR_RPC || "https://rpc.testnet.near.org";
const RATE = "2500000"; // 1 NEAR = 2.5 test dollars (6 decimals)
const provider = new JsonRpcProvider({ url: RPC });

const exists = (id) => provider.query({ request_type: "view_account", finality: "final", account_id: id }).then(() => true, () => false);
const view = (contractId, method, args = {}) => provider.callFunction({ contractId, method, args });

(async () => {
  const key = JSON.parse(fs.readFileSync(process.env.KEY_FILE));
  const owner = new Account(key.account_id, provider, key.private_key);
  const publicKey = KeyPair.fromString(key.private_key).getPublicKey();
  const tokenWasm = fs.readFileSync(path.join(__dirname, "../token/res/ajo_test_token.wasm"));
  const ajoWasm = fs.readFileSync(path.join(__dirname, "../contract/res/ajo_on_near.wasm"));
  const usdc = `usdc.${key.account_id}`;
  const usdt = `usdt.${key.account_id}`;

  const tokens = [
    { id: usdc, name: "Test USDC (Ajo on NEAR)", symbol: "tUSDC", partner: usdt },
    { id: usdt, name: "Test USDT (Ajo on NEAR)", symbol: "tUSDT", partner: usdc },
  ];
  // Storage for the code plus a margin for balances and keys.
  const fund = BigInt(tokenWasm.length) * 10n ** 19n + nearToYocto("0.25");

  for (const t of tokens) {
    if (await exists(t.id)) { console.log(`${t.id} exists, skipping`); continue; }
    console.log(`Creating ${t.id} with ${Number(fund) / 1e24} NEAR and deploying ${tokenWasm.length} bytes ...`);
    await owner.signAndSendTransaction({
      receiverId: t.id,
      actions: [
        actions.createAccount(),
        actions.transfer(fund),
        actions.addFullAccessKey(publicKey),
        actions.deployContract(tokenWasm),
        actions.functionCall("new", {
          owner: key.account_id, name: t.name, symbol: t.symbol, decimals: 6, near_rate: RATE, partner: t.partner,
        }, teraToGas("30")),
      ],
    });
    console.log(" ", await view(t.id, "ft_metadata"));
  }

  const migrated = await view(key.account_id, "get_config").then(() => true, () => false);
  if (migrated) {
    console.log("Ajo contract already on v2; updating code only.");
    await owner.deployContract(ajoWasm);
  } else {
    console.log(`Upgrading ${key.account_id} (${ajoWasm.length} bytes) and migrating state in one transaction ...`);
    await owner.signAndSendTransaction({
      receiverId: key.account_id,
      actions: [
        actions.deployContract(ajoWasm),
        actions.functionCall("migrate", { allowed_tokens: [usdc, usdt] }, teraToGas("200")),
      ],
    });
  }
  console.log("config", await view(key.account_id, "get_config"));
  console.log("circles", await view(key.account_id, "get_circle_count"));
})().catch((e) => { console.error(e.message || e); process.exit(1); });
