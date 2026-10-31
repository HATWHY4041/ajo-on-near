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

**Iya Ajo**, an AI assistant, will remind members before payment day and answer questions like "when is my turn?" (in progress).

## Live on testnet

| | |
|---|---|
| Web app | **https://ajo-on-near.vercel.app** (connect a testnet wallet such as Meteor) |
| Contract | [`ajo-on-near.testnet`](https://testnet.nearblocks.io/address/ajo-on-near.testnet) |
| Network | NEAR testnet |
| Wasm sha256 | see [`contract/res/ajo_on_near.wasm.sha256`](contract/res/ajo_on_near.wasm.sha256) |

## Try it (for judges)

**In the browser:** open https://ajo-on-near.vercel.app, click **Connect wallet** and pick a NEAR testnet wallet. Click **Start a circle**, choose 2 members and "Every 5 minutes", and create it. Open the circle page from a second testnet account and click **Join**: the ring fills, the payout order is shuffled, and a countdown starts. Each member clicks **Pay**; when the last one pays, the gold seat receives the pot and the next round begins.

**From the command line:**

All commands use the [NEAR CLI](https://docs.near.org/tools/near-cli). Amounts are in yoctoNEAR (1 NEAR = 10^24).

**Read existing circles** — see circle 0, a completed 2-member circle:
```bash
near view ajo-on-near.testnet get_circle '{"circle_id": 0}'
```
You'll see `"status": "Completed"`, two `history` entries (one payout per member), and every member with `received_payout: true`.

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

**Or run the scripted end-to-end check:** `cd scripts && npm install && KEY_A=a.json KEY_B=b.json node smoke-test.js`

**Unit tests** (18 tests: full circle, missed payments, deposit cover, refunds, trust gating, input validation):
```bash
cd contract && cargo test
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
| `get_circle_count()`, `now_ms()` | view | Helpers for clients. |

The contract emits NEP-297 style `EVENT_JSON` logs (`circle_created`, `member_joined`, `circle_started`, `contribution`, `missed_payment`, `payout`, `circle_completed`) for indexers.

**Known limits:** a security deposit equals one contribution, so it covers one missed payment. A member who has already been paid and then stops paying can cost the group at most their deposit plus later shortfalls, which are visible in `history[].missed_by` and their trust record. Circles use native NEAR. Stablecoin and any-token payments (NEAR Intents) are planned next.

## Repository layout

```
contract/          Rust smart contract (near-sdk 5.30)
  src/lib.rs       contract
  src/tests.rs     unit tests
  res/             wasm + ABI built by CI (cargo-near)
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
