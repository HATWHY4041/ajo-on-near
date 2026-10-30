// Deploy contract/res/ajo_on_near.wasm and initialise it.
// Usage: KEY_FILE=path/to/key.json node deploy.js
// The key file is {"account_id": "...", "private_key": "ed25519:..."}.
// It is never committed to this repo.
const { Account, JsonRpcProvider, teraToGas } = require("near-api-js");
const fs = require("fs");
const path = require("path");

const RPC = process.env.NEAR_RPC || "https://rpc.testnet.near.org";

(async () => {
  const key = JSON.parse(fs.readFileSync(process.env.KEY_FILE));
  const provider = new JsonRpcProvider({ url: RPC });
  const account = new Account(key.account_id, provider, key.private_key);
  const wasm = fs.readFileSync(path.join(__dirname, "../contract/res/ajo_on_near.wasm"));

  console.log(`Deploying ${wasm.length} bytes to ${key.account_id} ...`);
  await account.deployContract(wasm);

  const state = await provider.query({
    request_type: "view_state", finality: "final", account_id: key.account_id, prefix_base64: "",
  }).catch(() => ({ values: [] }));
  if (!state.values || state.values.length === 0) {
    console.log("Initialising ...");
    await account.callFunction({
      contractId: key.account_id, methodName: "new", args: {}, gas: teraToGas("30"),
    });
  } else {
    console.log("Already initialised; code updated only.");
  }
  const count = await provider.callFunction({
    contractId: key.account_id, method: "get_circle_count", args: {},
  });
  console.log("Deployed. Circles:", count);
})().catch((e) => { console.error(e.message || e); process.exit(1); });
