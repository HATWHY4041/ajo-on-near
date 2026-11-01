# Ajo on NEAR

**A rotating savings circle (ajo / esusu) where the collector is a smart contract, so nobody can run off with the money.**

Built for the NEAR HACKATHON (Nov 1–14, 2026) — Real-World Money track.

## The problem

Millions of people across Africa save through ajo (also called esusu or susu): a group of people pay a fixed amount every week, and each week one member takes home the whole pot. It works, but it depends on trusting one human collector. When the collector disappears, everyone loses.

## The solution

Ajo on NEAR replaces the human collector with a NEAR smart contract:

1. **Create a circle**: set the contribution amount, round length and number of members. The creator joins by locking a security deposit equal to one contribution.
2. **Join with a deposit**: each member locks the same deposit. When the circle is full, the payout order is shuffled with the block's random seed and round 1 starts.
3. **Pay each round**: when every member has paid, the whole pot goes to that round's recipient immediately.
4. **Missed payments**: after a round's deadline, anyone can call `settle_round`. The missing contribution is taken from the defaulter's deposit, the miss is recorded, and the recipient still gets paid.
5. **Trust record**: when the circle ends, leftover deposits are refunded and every member's onchain trust record is updated. A circle can require a minimum trust score to join.

6. **Pay with any NEAR token, save in NEAR**: circles save in NEAR. A member can pay with NEAR, or with USDC (Circle's testnet USDC), USDT (test token) or wNEAR. The tokens go to a swap desk contract, which converts them to exactly the NEAR the circle needs and pays the circle on the member's behalf (`pay_for`), in the same transaction. If the circle refuses the payment, the tokens are refunded. On testnet the desk uses fixed, published rates (1 NEAR = 2.5 USDC/USDT; 1 wNEAR = 1 NEAR) from its own NEAR reserve; on mainnet this would be NEAR Intents at market prices. Older dollar circles (tUSDC) created before this change still run.
7. **Iya Ajo**, the assistant on every circle page, answers "when is my turn?", "who hasn't paid?", "when is the deadline?", "what if I miss?" and "what's my trust score?" from the circle's live on-chain record.
8. **Reminders**: one tap adds every remaining payment date to your calendar (an `.ics` file with an alarm before each), or sends the group a WhatsApp or SMS reminder listing the amount, the deadline and who still has to pay.

Everything runs on **NEAR testnet**. No real money moves.

## Live on testnet

| | |
|---|---|
| Web app | **https://ajo-on-near.vercel.app** (connect a testnet wallet such as Meteor) |
| Ajo contract | [`ajo-on-near.testnet`](https://testnet.nearblocks.io/address/ajo-on-near.testnet) |
| Swap desk | [`swap.ajo-on-near.testnet`](https://testnet.nearblocks.io/address/swap.ajo-on-near.testnet): converts USDC, tUSDT, tUSDC and wNEAR to NEAR at fixed test rates |
| Accepted tokens | Circle testnet USDC [`3e2210e1…b8af`](https://testnet.nearblocks.io/address/3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af) (free at [faucet.circle.com](https://faucet.circle.com/), pick Near Testnet), [`wrap.testnet`](https://testnet.nearblocks.io/address/wrap.testnet) (wNEAR) |
| Test stablecoins | [`usdc.ajo-on-near.testnet`](https://testnet.nearblocks.io/address/usdc.ajo-on-near.testnet) (tUSDC), [`usdt.ajo-on-near.testnet`](https://testnet.nearblocks.io/address/usdt.ajo-on-near.testnet) (tUSDT), 6 decimals, free faucet |
| Network | NEAR testnet |
| Wasm sha256 | see [`contract/res/ajo_on_near.wasm.sha256`](contract/res/ajo_on_near.wasm.sha256) |

## Try it (for judges)

**In the browser:** open https://ajo-on-near.vercel.app, click **Connect wallet** and pick a NEAR testnet wallet. Click **Start a circle**, choose 0.01 NEAR, 2 members and "Every 5 minutes". Under **Pay with**, pick NEAR, or press **Get 100 tUSDT** under *Your testnet balances* and pick tUSDT, then create it. Open the circle page from a second testnet account and click **Join**: the ring fills, the payout order is shuffled, and a countdown starts. Each member picks what to **Pay with** (NEAR, USDC, tUSDT or wNEAR; the cost in each is shown) and clicks **Pay**; when the last one pays, the gold seat receives the pot and the next round begins. Try **Ask Iya Ajo** and the reminder buttons on the same page.

**From the command line:**

All commands use the [NEAR CLI](https://docs.near.org/tools/near-cli). Amounts are in yoctoNEAR (1 NEAR = 10^24).

**Read existing circles** — see circle 0, a completed 2-member circle:
```bash
near view ajo-on-near.testnet get_circle '{"circle_id": 0}'
```
You'll see `"status": "Completed"`, two `history` entries (one payout per member), and every member with `received_payout: true`.

**See a NEAR circle paid with other tokens** (circle 3, run by `scripts/smoke-test-v3.js`: created and paid with tUSDT by one member and with wNEAR by the other, all converted to NEAR):
```bash
near view ajo-on-near.testnet get_circle '{"circle_id": 3}'
near view swap.ajo-on-near.testnet quote '{"token":"usdt.ajo-on-near.testnet","near_amount":"10000000000000000000000"}'   # 25000 = 0.025 tUSDT for 0.01 NEAR
```
You'll see `"token": null` (a NEAR circle), `"status": "Completed"` and two payouts of 0.02 NEAR.

**See a finished stablecoin circle** (circle 2, run by `scripts/smoke-test-v2.js`: created with tUSDC, joined with tUSDT, paid with NEAR):
```bash
near view ajo-on-near.testnet get_circle '{"circle_id": 2}'
```
You'll see `"token": "usdc.ajo-on-near.testnet"`, `"status": "Completed"` and two payouts of `20000` (0.02 tUSDC).

**Check a trust record**:
```bash
near view ajo-on-near.testnet get_trust '{"account_id": "0e4870a750918e6185879c056350c6d9e21ac3597f6211535e0eb26145098d67"}'
```
You'll see `circles_completed: 1, on_time_payments: 2, score: 100`.

**Run your own circle** with two testnet accounts (A and B), 0.01 NEAR per round, 5-minute rounds:
```bash
near call ajo-on-near.testnet create_circle '{"name":"Test","contribution":"10000000000000000000000","max_members":2,"period_minutes":5}' --accountId A.testnet --deposit 0.01
# returns the circle id, e.g. 1
near call ajo-on-near.testnet join_circle '{"circle_id":1}' --accountId B.testnet --deposit 0.01
near view ajo-on-near.testnet get_circle '{"circle_id":1}'      # status Active, payout order shuffled
near call ajo-on-near.testnet contribute '{"circle_id":1}' --accountId A.testnet --deposit 0.01
near call ajo-on-near.testnet contribute '{"circle_id":1}' --accountId B.testnet --deposit 0.01
near view ajo-on-near.testnet get_circle '{"circle_id":1}'      # history[0]: 0.02 NEAR paid to the first member
```
To see a missed payment: in a round, have only A pay, wait for the deadline, then `near call ajo-on-near.testnet settle_round '{"circle_id":1}' --accountId A.testnet`. B's `deposit_left` drops to 0, `missed_payments` becomes 1, and the recipient still gets the full pot.

**A stablecoin circle from the CLI** (0.01 tUSDC = `10000`):
```bash
near call usdc.ajo-on-near.testnet faucet '{}' --accountId A.testnet
near call usdc.ajo-on-near.testnet ft_transfer_call '{"receiver_id":"ajo-on-near.testnet","amount":"10000","msg":"{\"action\":\"create\",\"name\":\"Dollars\",\"max_members\":2,\"period_minutes\":5}"}' --accountId A.testnet --depositYocto 1 --gas 300000000000000
# B joins paying with NEAR: buys exactly 0.01 tUSDC at the test rate and forwards it, in one transaction
near view usdc.ajo-on-near.testnet near_for '{"amount":"10000"}'
near call usdc.ajo-on-near.testnet buy_with_near '{"receiver_id":"ajo-on-near.testnet","forward_amount":"10000","msg":"{\"action\":\"join\",\"circle_id\":ID}"}' --accountId B.testnet --deposit 0.004 --gas 300000000000000
```

**Pay a NEAR circle with a token from the CLI** (here 0.01 NEAR paid with tUSDT):
```bash
near call usdt.ajo-on-near.testnet faucet '{}' --accountId A.testnet
near call usdt.ajo-on-near.testnet ft_transfer_call '{"receiver_id":"swap.ajo-on-near.testnet","amount":"25000","msg":"{\"near_amount\":\"10000000000000000000000\",\"action\":{\"action\":\"contribute\",\"circle_id\":ID}}"}' --accountId A.testnet --depositYocto 1 --gas 300000000000000
```

**Or run the scripted end-to-end checks:** `cd scripts && npm install && KEY_A=a.json KEY_B=b.json node smoke-test.js` (NEAR circle) `node smoke-test-v2.js` (tUSDC circle paid with tUSDC, tUSDT and NEAR, plus a refused payment that is refunded) and `node smoke-test-v3.js` (NEAR circle paid with tUSDT and wNEAR through the swap desk, plus a refused payment that is refunded).

**Unit tests** (44 tests: full circle, missed payments, deposit cover, refunds, trust gating, input validation, stablecoin circles, wrong-token rejection, state migration, payments made through the swap desk; token faucet, test-rate purchase, swap and forwarding; swap desk quotes, rate checks, unknown tokens, reserve limits, owner-only settings):
```bash
cd contract && cargo test
cd token && cargo test
cd swap && cargo test
```

## Contract API

| Method | Type | Description |
|---|---|---|
| `create_circle(name, contribution, max_members, period_minutes, min_trust_score?)` | call, attach `contribution` | Open a circle (2–20 members, 1 min–31 day rounds); creator joins. Returns id. |
| `join_circle(circle_id)` | call, attach `deposit` | Join an open circle; starts it when full. |
| `leave_circle(circle_id)` | call | Leave before start; deposit refunded. |
| `contribute(circle_id)` | call, attach `contribution` | Pay this round; last payer triggers the payout. |
| `settle_round(circle_id)` | call | After the deadline: cover unpaid shares from deposits and pay out. |
| `get_circle(circle_id)` | view | One circle with members, order, pot, history. |
| `get_circles(from_index?, limit?)` | view | Paginated list. |
| `get_circles_for(account_id)` | view | Circles an account belongs to. |
| `get_trust(account_id)` | view | Circles completed, on-time and missed payments, score 0–100. |
| `ft_on_transfer(sender_id, amount, msg)` | NEP-141 receiver | Stablecoin entry point. `msg` is `{"action":"create","name",...}`, `{"action":"join","circle_id"}` or `{"action":"contribute","circle_id"}`. Wrong token or amount is refused and refunded. |
| `pay_for(member, action)` | call, attach NEAR | Only `swap.<this account>`: a payment made for `member` after converting their tokens; `action` is the same JSON as `ft_on_transfer`'s msg. |
| `get_config()` | view | Owner and accepted stablecoins. |
| `get_circle_count()`, `now_ms()` | view | Helpers for clients. |

Each circle has a `token` field (`null` = NEAR). Token circles pay out and refund with `ft_transfer`.

**Swap desk (`swap/`)**: `ft_on_transfer(sender_id, amount, msg)` with msg `{"near_amount":"<yocto>","action":{...}}` converts the tokens at the token's fixed rate, pays `ajo.pay_for` with exactly `near_amount` from its reserve, and refunds the tokens if the circle refuses. Views: `quote(token, near_amount)` (tokens needed, rounded up), `get_rates()`, `reserve()`. Owner: `set_rate`, `withdraw`; anyone: `fund`.

**Test stablecoin (`token/`)**: NEP-141 (`ft_transfer`, `ft_transfer_call`, `ft_balance_of`, `ft_metadata`, no storage registration needed) plus `faucet()` (100 tokens an hour), `buy_with_near(receiver_id?, forward_amount?, msg?)` at the fixed test rate, `near_for(amount)`, and a 1:1 swap from the partner token via `ft_transfer_call` that can forward straight to a circle.

The contract emits NEP-297 style `EVENT_JSON` logs (`circle_created`, `member_joined`, `circle_started`, `contribution`, `missed_payment`, `payout`, `circle_completed`) for indexers.

**Known limits:** a security deposit equals one contribution, so it covers one missed payment. A member who has already been paid and then stops paying can cost the group at most their deposit plus later shortfalls, which are visible in `history[].missed_by` and their trust record. On testnet, conversions to NEAR go through the project's swap desk at fixed rates from a NEAR reserve, because NEAR Intents has no testnet; if the reserve runs low, token payments are refused (and refunded) until it is topped up, and paying in NEAR always works.

## Repository layout

```
contract/          Ajo smart contract (near-sdk 5.30)
  src/lib.rs       contract
  src/tests.rs     unit tests
  res/             wasm + ABI built by CI (cargo-near)
token/             test stablecoin (tUSDC / tUSDT), NEP-141 with faucet and conversion
swap/              swap desk: other NEAR tokens to NEAR for circle payments
  res/             wasm built by CI
  res/             wasm built by CI
web/               React + Vite web app (wallets via @hot-labs/near-connect)
scripts/           deploy and end-to-end scripts (near-api-js)
.github/workflows  CI: tests, builds wasm with cargo-near
```

## Built with

- NEAR Protocol (testnet), [near-sdk-rs](https://github.com/near/near-sdk-rs) 5.30, [cargo-near](https://github.com/near/cargo-near)
- [near-api-js](https://github.com/near/near-api-js) 7 for scripts
- [NEAR Connect](https://github.com/hot-dao/near-selector) (`@hot-labs/near-connect`) for wallet login, React 19, Vite, hosted on Vercel
- No templates or pre-hackathon code. Code was written with the help of an AI coding assistant (Claude).

## License

MIT. See [LICENSE](LICENSE).
