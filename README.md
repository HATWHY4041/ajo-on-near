# Ajo on NEAR

**A rotating savings circle (ajo / esusu) where the collector is a smart contract, so nobody can run off with the money.**

Built for the NEAR HACKATHON (Nov 1–14, 2026) — Real-World Money track.

## The problem

Millions of people across Africa save through ajo (also called esusu or susu): a group of people pay a fixed amount every week, and each week one member takes home the whole pot. It works, but it depends on trusting one human collector. When the collector disappears, everyone loses.

## The solution

Ajo on NEAR replaces the human collector with a NEAR smart contract:

1. **Create a circle** — set the contribution amount, how often members pay, and how many members.
2. **Join with a deposit** — each member locks a small security deposit, which they lose if they stop paying.
3. **Pay each round** — members pay in any token they hold; NEAR Intents converts it to the circle's stablecoin.
4. **Automatic payout** — each round, the full pot goes to the next member in line.
5. **Trust badge** — members who always pay on time earn an onchain trust record for joining future circles.

**Iya Ajo**, an AI assistant, reminds members before payment day, explains the circle's status in plain language, and answers questions like "when is my turn?"

## Status

Planning and setup. Development begins November 1, 2026.

## Planned stack

- NEAR smart contract (holds funds, enforces rotation and deposits)
- NEAR Intents (pay in any token)
- Web app (create/join circles, see whose turn it is)
- Iya Ajo AI assistant
- Runs on NEAR testnet for the demo

## For AI judges

This section will document the contract methods, how to run the demo, and where each requirement is implemented.
