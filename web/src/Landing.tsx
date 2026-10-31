import { useMemo } from "react";
import { CONTRACT_ID, EXPLORER, Circle, fromYocto, toYocto } from "./near";
import { Ring } from "./Ring";

const EXAMPLE: Circle = {
  id: -1, name: "Example", creator: "", contribution: toYocto("10"), deposit: toYocto("10"),
  max_members: 6, period_minutes: 10080, min_trust_score: 0, status: "Active", current_round: 2,
  round_deadline_ms: 0, pot: "0", history: [], created_at_ms: 0,
  members: ["amaka", "tunde", "bisi", "kelechi", "funmi", "sade"].map((n, i) => ({
    account_id: `${n}.testnet`, deposit_left: toYocto("10"), paid_this_round: [0, 1, 3, 4].includes(i),
    on_time_payments: 0, missed_payments: 0, received_payout: i < 2,
  })),
};

/** Hero, live numbers and the explainer sections. The circle list is passed in as children. */
export function Landing({ circles, children }: { circles: Circle[] | null; children: React.ReactNode }) {
  const featured = useMemo(
    () => [...(circles ?? [])].reverse().find((c) => c.status === "Active" && c.max_members >= 3) ?? EXAMPLE,
    [circles],
  );
  const stats = useMemo(() => {
    const list = circles ?? [];
    let paid = 0n;
    let payouts = 0;
    const people = new Set<string>();
    for (const c of list) {
      c.members.forEach((m) => people.add(m.account_id));
      for (const h of c.history) { paid += BigInt(h.amount); payouts++; }
    }
    return {
      circles: list.length,
      running: list.filter((c) => c.status !== "Completed").length,
      people: people.size,
      payouts,
      paid: fromYocto(paid, 2),
    };
  }, [circles]);

  return (
    <>
      <section className="hero">
        <div className="hero__text">
          <h1>Save together. Nobody runs off with the pot.</h1>
          <p className="lede">
            Ajo, esusu, susu: the savings circle you already know. Everyone pays in each round and one member
            takes home the whole pot. Here, a contract on NEAR holds the money instead of a collector, and pays
            each member in turn.
          </p>
          <div className="hero__actions">
            <a className="btn btn--primary btn--big" href="#/new">Start a circle</a>
            <a className="btn btn--line btn--big" href="#circles">Find a circle to join</a>
          </div>
          <p className="hero__note">Live on NEAR testnet. Use free test NEAR to try every step.</p>
        </div>
        <div className="hero__ring">
          <Ring circle={featured} />
          <p className="caption">
            {featured.id < 0 ? (
              <>Example: six friends saving 10 NEAR a week. Round 3 of 6, and Bisi collects 60 NEAR once the last two pay.</>
            ) : (
              <>Live: <a href={`#/circle/${featured.id}`}>{featured.name}</a>, round {featured.current_round + 1} of {featured.max_members}.</>
            )}
          </p>
        </div>
      </section>

      <section className="stats" aria-label="Activity on the contract">
        <div><strong>{circles ? stats.circles : "…"}</strong><span>circles created</span></div>
        <div><strong>{circles ? stats.running : "…"}</strong><span>open or running now</span></div>
        <div><strong>{circles ? stats.people : "…"}</strong><span>members</span></div>
        <div><strong>{circles ? `${stats.paid} NEAR` : "…"}</strong><span>paid out in {stats.payouts} payouts</span></div>
        <p className="stats__src">
          Read live from <a href={`${EXPLORER}/address/${CONTRACT_ID}`} target="_blank" rel="noreferrer">{CONTRACT_ID}</a>
        </p>
      </section>

      <section className="section problem" id="why">
        <div className="section__head">
          <h2>The weak point of ajo has always been the collector</h2>
          <p className="lede">
            A savings circle works because members trust each other. But the money usually sits with one person,
            the records live in a notebook, and when something goes wrong there's little anyone can do.
          </p>
        </div>
        <div className="problem__grid">
          <div>
            <h3>What goes wrong today</h3>
            <ul className="xlist">
              <li>The collector disappears with a round's pot, or spends it and pays late.</li>
              <li>Someone who has already collected stops paying, and the last members lose out.</li>
              <li>Arguments over whose turn it is, or who paid, with no shared record to check.</li>
              <li>Joining a circle of strangers means trusting people you can't vet.</li>
            </ul>
          </div>
          <div>
            <h3>What Ajo on NEAR changes</h3>
            <ul className="ticklist">
              <li>Money goes into a contract, not a person's pocket. It can only pay the member whose turn it is.</li>
              <li>Every member locks a deposit up front, and it covers a missed payment.</li>
              <li>Turn order, payments and payouts are public on NEAR. Anyone can check them.</li>
              <li>Each finished circle adds to a member's trust score, so good savers can find each other.</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="section" id="how">
        <div className="section__head">
          <h2>How a circle runs</h2>
        </div>
        <ol className="steps">
          <li>
            <strong>Start a circle.</strong>
            Pick the amount, how often everyone pays (hourly, daily, weekly or monthly) and how many people, from 2 to 20.
          </li>
          <li>
            <strong>Invite and lock deposits.</strong>
            Share the circle's link. Each person who joins locks one payment as a security deposit. Anyone can leave
            and get it back until the circle is full.
          </li>
          <li>
            <strong>The order is drawn.</strong>
            When the last seat fills, the contract shuffles the payout order using NEAR's on-chain randomness. Nobody,
            including the person who started the circle, picks who goes first.
          </li>
          <li>
            <strong>Pay each round.</strong>
            Every member pays before the deadline. The moment the last payment lands, the whole pot is sent to that
            round's member automatically.
          </li>
          <li>
            <strong>Finish and get deposits back.</strong>
            After everyone has collected once, the contract returns what's left of each deposit and updates each
            member's trust score.
          </li>
        </ol>
      </section>

      <section className="section example" id="example">
        <div className="section__head">
          <h2>A worked example</h2>
          <p className="lede">
            Five traders in Ikeja save 10 NEAR every week. Each locks a 10 NEAR deposit when they join, and the
            contract draws the order: Ada, Bayo, Chika, Dayo, Efe.
          </p>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th scope="col">Week</th><th scope="col">Everyone pays</th><th scope="col">Collects</th><th scope="col">Payout</th><th scope="col">What happened</th></tr>
            </thead>
            <tbody>
              <tr><td data-label="Week">1</td><td data-label="Everyone pays">10 NEAR each</td><td data-label="Collects">Ada</td><td data-label="Payout">50 NEAR</td><td data-label="What happened">All five paid on time.</td></tr>
              <tr><td data-label="Week">2</td><td data-label="Everyone pays">10 NEAR each</td><td data-label="Collects">Bayo</td><td data-label="Payout">50 NEAR</td><td data-label="What happened">All five paid on time.</td></tr>
              <tr className="table__alert"><td data-label="Week">3</td><td data-label="Everyone pays">Dayo misses</td><td data-label="Collects">Chika</td><td data-label="Payout">50 NEAR</td><td data-label="What happened">After the deadline, the round is settled. Dayo's 10 NEAR comes from his deposit, so Chika still gets the full pot.</td></tr>
              <tr><td data-label="Week">4</td><td data-label="Everyone pays">10 NEAR each</td><td data-label="Collects">Dayo</td><td data-label="Payout">50 NEAR</td><td data-label="What happened">Dayo pays again and collects on his turn.</td></tr>
              <tr><td data-label="Week">5</td><td data-label="Everyone pays">10 NEAR each</td><td data-label="Collects">Efe</td><td data-label="Payout">50 NEAR</td><td data-label="What happened">Circle complete. Four deposits come back in full; Dayo's is already used.</td></tr>
            </tbody>
          </table>
        </div>
        <p className="example__foot">
          Everyone put in 50 NEAR and took out 50 NEAR, and the person collecting was never short. Dayo's record now
          shows 4 on-time payments and 1 missed, a trust score of 80.
        </p>
      </section>

      <section className="section" id="features">
        <div className="section__head">
          <h2>What's built in</h2>
        </div>
        <dl className="features">
          <div><dt>The contract holds the pot</dt><dd>Payments go to the Ajo contract on NEAR. It has one job: pay the member whose turn it is, then return deposits at the end. Nobody can withdraw it early.</dd></div>
          <div><dt>Fair, random order</dt><dd>The payout order is shuffled on-chain the moment the circle fills, so it can't be arranged in advance.</dd></div>
          <div><dt>Deposits that cover misses</dt><dd>Each member's deposit equals one payment. If someone misses a round, it fills the gap so the person collecting gets the full amount.</dd></div>
          <div><dt>No waiting on one person</dt><dd>When a deadline passes, any member can settle the round with one click. The pot never sits stuck because someone is unreachable.</dd></div>
          <div><dt>Trust scores</dt><dd>On-time and missed payments are recorded per account across every circle. Circle creators can require a minimum score, from 50 up to 100.</dd></div>
          <div><dt>Invite by link</dt><dd>Every circle has its own page. Copy the link or share it straight to WhatsApp or X, and people join from their wallet in a few taps.</dd></div>
          <div><dt>A public record</dt><dd>Every payment and payout is a NEAR transaction you can look up. The circle page shows who has paid this round, who has collected, and when.</dd></div>
          <div><dt>Works with NEAR wallets</dt><dd>Connect with Meteor, HOT, Intear, MyNearWallet and other NEAR wallets. No sign-up or email needed.</dd></div>
        </dl>
      </section>

      <section className="section" id="compare">
        <div className="section__head">
          <h2>Ajo with a collector, and Ajo on NEAR</h2>
        </div>
        <div className="table-wrap">
          <table className="table compare">
            <thead>
              <tr><th scope="col"></th><th scope="col">Collector-run ajo</th><th scope="col">Ajo on NEAR</th></tr>
            </thead>
            <tbody>
              <tr><th scope="row">Who holds the money</th><td data-label="Collector-run ajo">One person</td><td data-label="Ajo on NEAR">A public contract that can only pay the next member</td></tr>
              <tr><th scope="row">Who decides the order</th><td data-label="Collector-run ajo">The collector or the group</td><td data-label="Ajo on NEAR">Drawn at random on-chain when the circle fills</td></tr>
              <tr><th scope="row">If someone misses a payment</th><td data-label="Collector-run ajo">The person collecting is short</td><td data-label="Ajo on NEAR">Their deposit covers it and the miss is recorded</td></tr>
              <tr><th scope="row">Records</th><td data-label="Collector-run ajo">A notebook or group chat</td><td data-label="Ajo on NEAR">Every payment visible on NEAR</td></tr>
              <tr><th scope="row">Joining strangers</th><td data-label="Collector-run ajo">Trust a referral</td><td data-label="Ajo on NEAR">Check their trust score, or set a minimum</td></tr>
              <tr><th scope="row">Collector's fee</th><td data-label="Collector-run ajo">Often one member's share</td><td data-label="Ajo on NEAR">None; only NEAR network fees, fractions of a cent</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="section rules" id="rules">
        <div className="section__head">
          <h2>The rules, in plain words</h2>
          <p className="lede">These are enforced by the contract itself, the same way for every circle.</p>
        </div>
        <div className="rules__grid">
          <div><h3>Joining</h3><p>You join by locking a deposit equal to one payment. You can't join twice, join a full circle, or join below the circle's minimum trust score.</p></div>
          <div><h3>Leaving</h3><p>You can leave any time before the circle is full and get your whole deposit back. Once it starts, you're in until the end.</p></div>
          <div><h3>Paying</h3><p>Each round you pay exactly one payment, once, before the deadline. Late payments aren't accepted; the round is settled instead.</p></div>
          <div><h3>Missing a round</h3><p>Your deposit pays your share and the miss goes on your record. If your deposit is already used, the payout is smaller that round and everyone can see why.</p></div>
          <div><h3>Collecting</h3><p>Your turn's pot is sent to your wallet automatically, the moment the round closes. You don't need to claim it.</p></div>
          <div><h3>Finishing</h3><p>After the last round, leftover deposits are returned to every member and trust scores are updated.</p></div>
        </div>
        <p className="rules__limit">
          Honest limit: a deposit covers one missed payment. A member who collects early and then stops paying more
          than once can still leave the group short. That shows on their record, and circles with a minimum trust
          score keep such members out.
        </p>
      </section>

      {children}

      <section className="section faq" id="faq">
        <div className="section__head"><h2>Questions</h2></div>
        <div className="faq__list">
          <details>
            <summary>Is this real money?</summary>
            <p>Not yet. Ajo on NEAR runs on NEAR testnet, where tokens are free and have no value. That makes it safe to try every step, including missing a payment. Mainnet and stablecoins are next on the roadmap.</p>
          </details>
          <details>
            <summary>What do I need to start?</summary>
            <p>A NEAR testnet wallet such as Meteor Wallet, switched to testnet, and a little test NEAR from a faucet. Then click Connect wallet.</p>
          </details>
          <details>
            <summary>Can the person who starts a circle take the money?</summary>
            <p>No. The creator is just the first member. They lock the same deposit, pay the same amount, and get a turn drawn at random like everyone else. The contract only ever pays the member whose turn it is.</p>
          </details>
          <details>
            <summary>What happens if nobody settles a late round?</summary>
            <p>The round stays open until someone does. Any member, or anyone at all, can click Settle this round once the deadline passes. Usually the person collecting will, since they're the one waiting.</p>
          </details>
          <details>
            <summary>How is the trust score worked out?</summary>
            <p>It's the share of your payments made on time across every finished circle, from 0 to 100. Someone with 19 on-time payments and 1 miss scores 95. New accounts start without a score.</p>
          </details>
          <details>
            <summary>What does it cost?</summary>
            <p>There's no fee for using Ajo. Each payment is a NEAR transaction, which costs a tiny network fee, well under a cent.</p>
          </details>
          <details>
            <summary>Can I check the code?</summary>
            <p>Yes. The contract and this website are open source on <a href="https://github.com/HATWHY4041/ajo-on-near" target="_blank" rel="noreferrer">GitHub</a>, with tests for every rule above.</p>
          </details>
        </div>
      </section>

      <section className="section roadmap" id="roadmap">
        <div className="section__head"><h2>What's next</h2></div>
        <ul className="roadmap__list">
          <li className="is-done"><strong>Now</strong> Circles, deposits, automatic payouts, missed-payment cover, trust scores and invite links, live on testnet.</li>
          <li><strong>Next</strong> Pay in any token. NEAR Intents converts whatever a member holds, so circles can save in a stablecoin like USDC.</li>
          <li><strong>Next</strong> Iya Ajo, an assistant that reminds members before payment day and answers questions like "when is my turn?"</li>
          <li><strong>Later</strong> Mainnet launch, reminders by SMS and WhatsApp, and larger deposits for circles of strangers.</li>
        </ul>
      </section>

      <section className="cta">
        <h2>Bring your circle on-chain</h2>
        <p>Start one in under a minute and send the link to your group.</p>
        <a className="btn btn--gold btn--big" href="#/new">Start a circle</a>
      </section>
    </>
  );
}
