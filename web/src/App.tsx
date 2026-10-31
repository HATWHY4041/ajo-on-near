import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CONTRACT_ID, EXPLORER, Circle, Trust, call, connector, explainError, fromYocto, getCircle,
  getCircles, getTrust, periodLabel, shortAccount, timeLeft, times, toYocto,
} from "./near";
import { Ring } from "./Ring";

// ---------------------------------------------------------------- hooks

function useAccount() {
  const [account, setAccount] = useState<string | null>(null);
  useEffect(() => {
    connector.getConnectedWallet().then((w) => setAccount(w.accounts[0]?.accountId ?? null)).catch(() => {});
    const onIn = (t: { accounts: { accountId: string }[] }) => setAccount(t.accounts[0]?.accountId ?? null);
    const onOut = () => setAccount(null);
    connector.on("wallet:signIn", onIn);
    connector.on("wallet:signOut", onOut);
    return () => {
      connector.off?.("wallet:signIn", onIn);
      connector.off?.("wallet:signOut", onOut);
    };
  }, []);
  const signIn = () => connector.connect().catch(() => {});
  const signOut = () => connector.disconnect().catch(() => {});
  return { account, signIn, signOut };
}

function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

function useRoute() {
  const [hash, setHash] = useState(window.location.hash || "#/");
  useEffect(() => {
    const on = () => {
      setHash(window.location.hash || "#/");
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return hash;
}

type Notice = { kind: "ok" | "error"; text: string } | null;

// ---------------------------------------------------------------- app

export default function App() {
  const { account, signIn, signOut } = useAccount();
  const route = useRoute();
  const [circles, setCircles] = useState<Circle[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);

  const refresh = useCallback(async () => {
    try {
      setCircles(await getCircles());
      setLoadError(null);
    } catch (e) {
      setLoadError(explainError(e));
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 15000);
    return () => clearInterval(t);
  }, [refresh]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 7000);
    return () => clearTimeout(t);
  }, [notice]);

  const circleMatch = route.match(/^#\/circle\/(\d+)/);

  return (
    <>
      <header className="top">
        <a className="wordmark" href="#/">ajo<span className="wordmark__on">on NEAR</span></a>
        <nav className="top__nav">
          <a href="#/new" className="link">Start a circle</a>
          {account ? (
            <span className="who">
              <span className="who__id" title={account}>{shortAccount(account)}</span>
              <button className="btn btn--quiet" onClick={signOut}>Disconnect</button>
            </span>
          ) : (
            <button className="btn btn--primary" onClick={signIn}>Connect wallet</button>
          )}
        </nav>
      </header>

      {notice && (
        <div className={`notice notice--${notice.kind}`} role="status">
          {notice.text}
          <button className="notice__close" onClick={() => setNotice(null)} aria-label="Dismiss">×</button>
        </div>
      )}

      <main>
        {route.startsWith("#/new") ? (
          <CreateCircle account={account} signIn={signIn} setNotice={setNotice} onCreated={refresh} />
        ) : circleMatch ? (
          <CircleDetail id={Number(circleMatch[1])} account={account} signIn={signIn} setNotice={setNotice} onChanged={refresh} />
        ) : (
          <Home circles={circles} loadError={loadError} account={account} />
        )}
      </main>

      <footer className="foot">
        <p>
          Runs on NEAR testnet with test tokens, so no real money moves. Contract{" "}
          <a href={`${EXPLORER}/address/${CONTRACT_ID}`} target="_blank" rel="noreferrer">{CONTRACT_ID}</a>.
          Source on <a href="https://github.com/HATWHY4041/ajo-on-near" target="_blank" rel="noreferrer">GitHub</a>.
        </p>
      </footer>
    </>
  );
}

// ---------------------------------------------------------------- home

const EXAMPLE: Circle = {
  id: -1, name: "Example", creator: "", contribution: toYocto("1"), deposit: toYocto("1"),
  max_members: 6, period_minutes: 10080, min_trust_score: 0, status: "Active", current_round: 2,
  round_deadline_ms: 0, pot: "0", history: [], created_at_ms: 0,
  members: ["amaka", "tunde", "bisi", "kelechi", "funmi", "sade"].map((n, i) => ({
    account_id: `${n}.testnet`, deposit_left: toYocto("1"), paid_this_round: [0, 1, 3, 4].includes(i),
    on_time_payments: 0, missed_payments: 0, received_payout: i < 2,
  })),
};

function Home({ circles, loadError, account }: { circles: Circle[] | null; loadError: string | null; account: string | null }) {
  const open = (circles ?? []).filter((c) => c.status === "Open").reverse();
  const mine = account ? (circles ?? []).filter((c) => c.members.some((m) => m.account_id === account)).reverse() : [];
  const featured = useMemo(
    () => [...(circles ?? [])].reverse().find((c) => c.status === "Active" && c.max_members >= 3) ?? EXAMPLE,
    [circles],
  );

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
            <a className="btn btn--line btn--big" href="#open">Join an open circle</a>
          </div>
        </div>
        <div className="hero__ring">
          <Ring circle={featured} />
          <p className="caption">
            {featured.id < 0 ? (
              <>An example: round 3 of 6. Bisi collects this week once everyone has paid.</>
            ) : (
              <>Live: <a href={`#/circle/${featured.id}`}>{featured.name}</a>, round {featured.current_round + 1} of {featured.max_members}.</>
            )}
          </p>
        </div>
      </section>

      <section className="how">
        <h2>How a circle runs</h2>
        <ol className="steps">
          <li><strong>Set it up.</strong> Choose the amount, how often everyone pays, and how many people.</li>
          <li><strong>Lock a deposit.</strong> Each member locks one payment as a deposit. It covers a missed payment, so the person collecting is never short.</li>
          <li><strong>Pay each round.</strong> When the last member pays, the pot goes straight to whoever's turn it is.</li>
          <li><strong>Everyone collects once.</strong> At the end, deposits come back and on-time payers build a trust score for stricter circles.</li>
        </ol>
      </section>

      {account && (
        <section className="block">
          <div className="block__head">
            <h2>Your circles</h2>
            <TrustBadge account={account} />
          </div>
          {mine.length ? <CircleList circles={mine} account={account} /> : (
            <p className="empty">You aren't in a circle yet. <a href="#/new">Start one</a> or join an open circle below.</p>
          )}
        </section>
      )}

      <section className="block" id="open">
        <h2>Open circles</h2>
        {loadError && <p className="empty">Couldn't load circles from NEAR testnet: {loadError}</p>}
        {!circles && !loadError && <p className="empty">Loading circles…</p>}
        {circles && (open.length ? <CircleList circles={open} account={account} /> : (
          <p className="empty">No circles are taking members right now. <a href="#/new">Start the first one.</a></p>
        ))}
      </section>
    </>
  );
}

function CircleList({ circles, account }: { circles: Circle[]; account: string | null }) {
  return (
    <ul className="rows">
      {circles.map((c) => {
        const mine = account && c.members.some((m) => m.account_id === account);
        return (
          <li key={c.id}>
            <a className="row" href={`#/circle/${c.id}`}>
              <span className="row__name">{c.name}</span>
              <span className="row__money"><strong>{fromYocto(c.contribution)} NEAR</strong> {periodLabel(c.period_minutes)}</span>
              <span className="row__seats">
                {c.status === "Open" ? `${c.members.length} of ${c.max_members} seats` :
                  c.status === "Active" ? `Round ${c.current_round + 1} of ${c.max_members}` : "Complete"}
              </span>
              <span className="row__tag">
                {mine ? "You're in" : c.min_trust_score > 0 ? `Trust ${c.min_trust_score}+` : "Anyone can join"}
              </span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}

function TrustBadge({ account }: { account: string }) {
  const [t, setT] = useState<Trust | null>(null);
  useEffect(() => { getTrust(account).then(setT).catch(() => {}); }, [account]);
  if (!t) return null;
  const total = t.on_time_payments + t.missed_payments;
  return (
    <div className="trust" title="Share of your payments made on time, across finished circles">
      <span className="trust__score">{total ? t.score : "New"}</span>
      <span className="trust__text">
        {total
          ? `Trust score from ${t.on_time_payments} on-time and ${t.missed_payments} missed payments, ${t.circles_completed} circle${t.circles_completed === 1 ? "" : "s"} finished`
          : "No trust score yet. Finish a circle to earn one."}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------- create

const PERIODS = [
  { minutes: 5, label: "Every 5 minutes (for trying it out)" },
  { minutes: 60, label: "Every hour" },
  { minutes: 1440, label: "Every day" },
  { minutes: 10080, label: "Every week" },
  { minutes: 43200, label: "Every 30 days" },
];

function CreateCircle({ account, signIn, setNotice, onCreated }: {
  account: string | null; signIn: () => void; setNotice: (n: Notice) => void; onCreated: () => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("0.5");
  const [members, setMembers] = useState(5);
  const [period, setPeriod] = useState(10080);
  const [minTrust, setMinTrust] = useState(0);
  const [busy, setBusy] = useState(false);

  let yocto: string | null = null;
  let amountError: string | null = null;
  try {
    yocto = toYocto(amount);
    if (BigInt(yocto) === 0n) { yocto = null; amountError = "Enter an amount above 0"; }
  } catch (e) { amountError = (e as Error).message; }

  const periodText = PERIODS.find((p) => p.minutes === period)?.label.toLowerCase().replace(/ \(.*\)/, "") ?? periodLabel(period);

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    if (!account) return signIn();
    if (!yocto || !name.trim()) return;
    setBusy(true);
    try {
      await call("create_circle", {
        name: name.trim(), contribution: yocto, max_members: members, period_minutes: period,
        min_trust_score: minTrust || null,
      }, yocto);
      await onCreated();
      const all = await getCircles();
      const created = [...all].reverse().find((c) => c.creator === account && c.name === name.trim());
      setNotice({ kind: "ok", text: `Circle created. Share this page so others can join.` });
      window.location.hash = created ? `#/circle/${created.id}` : "#/";
    } catch (e) {
      setNotice({ kind: "error", text: explainError(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="page page--narrow">
      <a className="back" href="#/">Back to circles</a>
      <h1>Start a circle</h1>
      <p className="lede">You'll be the first member. Others join from the circle's page, and it starts once every seat is taken.</p>
      <form className="form" onSubmit={submit}>
        <label>
          <span>Circle name</span>
          <input value={name} maxLength={64} required placeholder="Ikeja traders" onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          <span>Each payment, in NEAR</span>
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={!!amountError} />
          {amountError && <em className="field-error">{amountError}</em>}
        </label>
        <div className="form__pair">
          <label>
            <span>Members</span>
            <input type="number" min={2} max={20} value={members} onChange={(e) => setMembers(Math.min(20, Math.max(2, Number(e.target.value) || 2)))} />
          </label>
          <label>
            <span>How often</span>
            <select value={period} onChange={(e) => setPeriod(Number(e.target.value))}>
              {PERIODS.map((p) => <option key={p.minutes} value={p.minutes}>{p.label}</option>)}
            </select>
          </label>
        </div>
        <label>
          <span>Minimum trust score to join</span>
          <select value={minTrust} onChange={(e) => setMinTrust(Number(e.target.value))}>
            <option value={0}>Anyone can join</option>
            <option value={50}>50 or higher</option>
            <option value={80}>80 or higher</option>
            <option value={100}>100 (never missed a payment)</option>
          </select>
        </label>

        {yocto && (
          <p className="summary">
            Each member locks <strong>{fromYocto(yocto)} NEAR</strong> as a deposit, then pays{" "}
            <strong>{fromYocto(yocto)} NEAR</strong> {periodText}. Each round, one member collects{" "}
            <strong>{fromYocto(times(yocto, members))} NEAR</strong>. The circle runs {members} rounds.
          </p>
        )}

        <button className="btn btn--primary btn--big" disabled={busy || (!!account && (!yocto || !name.trim()))}>
          {!account ? "Connect wallet to continue" : busy ? "Waiting for your wallet…" : `Create circle and lock ${yocto ? fromYocto(yocto) : ""} NEAR`}
        </button>
      </form>
    </section>
  );
}

// ---------------------------------------------------------------- detail

function CircleDetail({ id, account, signIn, setNotice, onChanged }: {
  id: number; account: string | null; signIn: () => void; setNotice: (n: Notice) => void; onChanged: () => Promise<void>;
}) {
  const [c, setC] = useState<Circle | null | undefined>(undefined);
  const [busy, setBusy] = useState<string | null>(null);
  const now = useNow();

  const load = useCallback(() => getCircle(id).then(setC).catch(() => setC(null)), [id]);
  useEffect(() => {
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [load]);

  if (c === undefined) return <section className="page"><p className="empty">Loading circle…</p></section>;
  if (c === null) return <section className="page"><a className="back" href="#/">Back to circles</a><p className="empty">There's no circle number {id}.</p></section>;

  const me = account ? c.members.findIndex((m) => m.account_id === account) : -1;
  const member = me >= 0 ? c.members[me] : null;
  const recipient = c.status === "Active" ? c.members[c.current_round] : null;
  const late = c.status === "Active" && now > c.round_deadline_ms;
  const pot = times(c.contribution, c.members.length);

  async function act(method: string, deposit: string, done: string) {
    if (!account) return signIn();
    setBusy(method);
    try {
      await call(method, { circle_id: id }, deposit);
      await load();
      await onChanged();
      setNotice({ kind: "ok", text: done });
    } catch (e) {
      setNotice({ kind: "error", text: explainError(e) });
    } finally {
      setBusy(null);
    }
  }

  let action: React.ReactNode = null;
  if (c.status === "Open") {
    action = member ? (
      <>
        <p className="state">You're in. Waiting for {c.max_members - c.members.length} more {c.max_members - c.members.length === 1 ? "person" : "people"} to join.</p>
        <button className="btn btn--line" disabled={!!busy} onClick={() => act("leave_circle", "0", "You left the circle. Your deposit is on its way back.")}>
          {busy ? "Waiting for your wallet…" : "Leave and get my deposit back"}
        </button>
      </>
    ) : (
      <button className="btn btn--primary btn--big" disabled={!!busy} onClick={() => act("join_circle", c.deposit, "You joined the circle.")}>
        {!account ? "Connect wallet to join" : busy ? "Waiting for your wallet…" : `Join and lock ${fromYocto(c.deposit)} NEAR deposit`}
      </button>
    );
  } else if (c.status === "Active") {
    const settle = (
      <button className="btn btn--line" disabled={!!busy} onClick={() => act("settle_round", "0", "Round settled. Missed payments came from deposits and the pot was paid out.")}>
        {busy === "settle_round" ? "Waiting for your wallet…" : "Settle this round"}
      </button>
    );
    if (late) {
      action = (
        <>
          <p className="state state--warn">This round's deadline has passed. Anyone can settle it: missing payments come out of those members' deposits, and {shortAccount(recipient!.account_id)} still gets the full pot.</p>
          {account ? settle : <button className="btn btn--primary" onClick={signIn}>Connect wallet to settle</button>}
        </>
      );
    } else if (member && !member.paid_this_round) {
      action = (
        <button className="btn btn--primary btn--big" disabled={!!busy} onClick={() => act("contribute", c.contribution, "Payment sent. Thank you for paying on time.")}>
          {busy ? "Waiting for your wallet…" : `Pay ${fromYocto(c.contribution)} NEAR for round ${c.current_round + 1}`}
        </button>
      );
    } else if (member) {
      action = <p className="state state--ok">You've paid for round {c.current_round + 1}. The pot goes out as soon as everyone else pays.</p>;
    } else {
      action = <p className="state">This circle is full and running. You can follow along here.</p>;
    }
  } else {
    action = <p className="state state--ok">This circle is complete. Every member collected once and deposits were returned.</p>;
  }

  return (
    <section className="page detail">
      <a className="back" href="#/">Back to circles</a>
      <div className="detail__grid">
        <div className="detail__ring">
          <Ring circle={c} me={account} />
          <Legend />
        </div>
        <div className="detail__side">
          <h1>{c.name}</h1>
          <p className="terms">
            <strong>{fromYocto(c.contribution)} NEAR</strong> {periodLabel(c.period_minutes)}, {c.max_members} members.
            Each payout is <strong>{fromYocto(pot)} NEAR</strong>.
            {c.min_trust_score > 0 && <> Members need a trust score of {c.min_trust_score} or more.</>}
          </p>

          {c.status === "Active" && recipient && (
            <div className="turn">
              <span className="turn__who">{recipient.account_id === account ? "You collect" : `${shortAccount(recipient.account_id)} collects`} this round</span>
              <span className={`turn__clock${late ? " turn__clock--late" : ""}`}>{timeLeft(c.round_deadline_ms, now)}</span>
            </div>
          )}

          <div className="action">{action}</div>

          <h2>{c.status === "Open" ? "Members so far" : "Payout order"}</h2>
          <ol className="members">
            {c.members.map((m, i) => {
              let st = "";
              if (c.status === "Active") {
                st = i === c.current_round ? "Collecting now" : m.received_payout ? "Collected" : `Collects in round ${i + 1}`;
              } else if (c.status === "Completed") st = `Collected in round ${i + 1}`;
              else st = m.account_id === c.creator ? "Started the circle" : "Joined";
              return (
                <li key={m.account_id} className={m.account_id === account ? "members__me" : ""}>
                  <span className="members__id" title={m.account_id}>{shortAccount(m.account_id)}{m.account_id === account && " (you)"}</span>
                  <span className="members__st">{st}</span>
                  {c.status === "Active" && (
                    <span className={`chip ${m.paid_this_round ? "chip--paid" : "chip--due"}`}>{m.paid_this_round ? "Paid" : "Not paid"}</span>
                  )}
                  {m.missed_payments > 0 && <span className="chip chip--missed">Missed {m.missed_payments}</span>}
                </li>
              );
            })}
          </ol>

          {c.history.length > 0 && (
            <>
              <h2>Payouts</h2>
              <ol className="history">
                {[...c.history].reverse().map((h) => (
                  <li key={h.round}>
                    <span>Round {h.round}: <strong>{fromYocto(h.amount)} NEAR</strong> to {shortAccount(h.recipient)}</span>
                    <span className="history__when">{new Date(h.paid_at_ms).toLocaleString()}</span>
                    {h.missed_by.length > 0 && (
                      <span className="history__miss">Covered from the deposit of {h.missed_by.map(shortAccount).join(", ")}</span>
                    )}
                  </li>
                ))}
              </ol>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function Legend() {
  return (
    <ul className="legend" aria-label="Key">
      <li><i className="dot dot--collecting" />Collects this round</li>
      <li><i className="dot dot--paid" />Paid</li>
      <li><i className="dot dot--waiting" />Not paid yet</li>
    </ul>
  );
}
