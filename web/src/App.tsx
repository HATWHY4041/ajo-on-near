import { useCallback, useEffect, useState } from "react";
import {
  CONTRACT_ID, CURRENCIES, Circle, Currency, EXPLORER, NEAR, TUSDC, Trust, call, connector, currencyOf, explainError,
  getCircle, getCircles, getTrust, money, payIn, periodLabel, shortAccount, timeLeft, times, toUnits,
} from "./near";
import { Ring } from "./Ring";
import { Landing } from "./Landing";
import { IyaAjo, PayWith, Reminders, Wallet, useBalances } from "./Extras";

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
      const h = window.location.hash || "#/";
      setHash(h);
      if (h.startsWith("#/")) window.scrollTo(0, 0);
      else setTimeout(() => document.getElementById(h.slice(1))?.scrollIntoView({ behavior: "smooth" }), 60);
    };
    if (!(window.location.hash || "#/").startsWith("#/")) on();
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
        <div className="top__inner">
          <a className="wordmark" href="#/">ajo<span className="wordmark__on">on NEAR</span></a>
          <nav className="top__links" aria-label="Sections">
            <a href="#how">How it works</a>
            <a href="#features">Features</a>
            <a href="#stablecoins">Stablecoins</a>
            <a href="#rules">Rules</a>
            <a href="#circles">Circles</a>
            <a href="#faq">FAQ</a>
          </nav>
          <div className="top__nav">
            {account ? (
              <span className="who">
                <span className="who__id" title={account}>{shortAccount(account)}</span>
                <button className="btn btn--quiet" onClick={signOut}>Disconnect</button>
              </span>
            ) : (
              <button className="btn btn--primary" onClick={signIn}>Connect wallet</button>
            )}
          </div>
        </div>
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
          <CircleDetail id={Number(circleMatch[1])} fresh={route.endsWith("/new")} account={account} signIn={signIn} setNotice={setNotice} onChanged={refresh} />
        ) : (
          <Landing circles={circles}>
            <CirclesSection circles={circles} loadError={loadError} account={account} />
          </Landing>
        )}
      </main>

      <footer className="foot">
        <div className="foot__inner">
          <div className="foot__brand">
            <a className="wordmark" href="#/">ajo<span className="wordmark__on">on NEAR</span></a>
            <p>Rotating savings circles with a smart contract as the collector. Built for the NEAR Hackathon 2026, Real-World Money track.</p>
          </div>
          <div>
            <h3>Use it</h3>
            <ul>
              <li><a href="#/new">Start a circle</a></li>
              <li><a href="#circles">Join a circle</a></li>
              <li><a href="#faq">Questions</a></li>
            </ul>
          </div>
          <div>
            <h3>Check it</h3>
            <ul>
              <li><a href={`${EXPLORER}/address/${CONTRACT_ID}`} target="_blank" rel="noreferrer">Contract on NearBlocks</a></li>
              <li><a href="https://github.com/HATWHY4041/ajo-on-near" target="_blank" rel="noreferrer">Source code</a></li>
              <li><a href="https://x.com/ayoadhe" target="_blank" rel="noreferrer">@ayoadhe on X</a></li>
            </ul>
          </div>
        </div>
        <p className="foot__small">Runs on NEAR testnet with test tokens (test NEAR, tUSDC and tUSDT), so no real money moves. Contract {CONTRACT_ID}.</p>
      </footer>
    </>
  );
}

// ---------------------------------------------------------------- home

function CirclesSection({ circles, loadError, account }: { circles: Circle[] | null; loadError: string | null; account: string | null }) {
  const open = (circles ?? []).filter((c) => c.status === "Open").reverse();
  const running = (circles ?? []).filter((c) => c.status === "Active").reverse();
  const mine = account ? (circles ?? []).filter((c) => c.members.some((m) => m.account_id === account)).reverse() : [];

  return (
    <section className="section circles" id="circles">
      <div className="section__head section__head--row">
        <h2>Circles</h2>
        <a className="btn btn--primary" href="#/new">Start a circle</a>
      </div>

      {account && (
        <div className="circles__group">
          <div className="block__head">
            <h3>Your circles</h3>
            <TrustBadge account={account} />
          </div>
          {mine.length ? <CircleList circles={mine} account={account} /> : (
            <p className="empty">You aren't in a circle yet. Start one, or join an open circle below.</p>
          )}
        </div>
      )}

      <div className="circles__group">
        <h3>Taking members now</h3>
        {loadError && <p className="empty">Couldn't load circles from NEAR testnet: {loadError}</p>}
        {!circles && !loadError && <p className="empty">Loading circles…</p>}
        {circles && (open.length ? <CircleList circles={open} account={account} /> : (
          <p className="empty">No circles are taking members right now. <a href="#/new">Start the first one</a> and share the link with your group.</p>
        ))}
      </div>

      {running.length > 0 && (
        <div className="circles__group">
          <h3>Running now</h3>
          <CircleList circles={running.slice(0, 8)} account={account} />
        </div>
      )}
    </section>
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
              <span className="row__money"><strong>{money(c.contribution, c.token)}</strong> {periodLabel(c.period_minutes)}</span>
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
  const [cur, setCur] = useState<Currency>(TUSDC);
  const [payWith, setPayWith] = useState<Currency>(TUSDC);
  const [amount, setAmount] = useState("10");
  const { balances, reload } = useBalances(account);
  const [members, setMembers] = useState(5);
  const [period, setPeriod] = useState(10080);
  const [minTrust, setMinTrust] = useState(0);
  const [busy, setBusy] = useState(false);

  let yocto: string | null = null;
  let amountError: string | null = null;
  try {
    yocto = toUnits(amount, cur.decimals);
    if (BigInt(yocto) === 0n) { yocto = null; amountError = "Enter an amount above 0"; }
  } catch (e) { amountError = (e as Error).message; }
  const fmt = (v: string) => money(v, cur.id);

  function pickCurrency(c: Currency) {
    setCur(c);
    setPayWith(c);
    setAmount(c.id ? "10" : "0.5");
  }

  const periodText = PERIODS.find((p) => p.minutes === period)?.label.toLowerCase().replace(/ \(.*\)/, "") ?? periodLabel(period);

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    if (!account) return signIn();
    if (!yocto || !name.trim()) return;
    setBusy(true);
    try {
      await payIn(cur.id, cur.id ? payWith : NEAR, yocto, {
        action: "create", name: name.trim(), max_members: members, period_minutes: period, min_trust_score: minTrust || null,
      });
      await onCreated();
      reload();
      const all = await getCircles();
      const created = [...all].reverse().find((c) => c.creator === account && c.name === name.trim());
      setNotice({ kind: "ok", text: "Circle created. Now invite your members." });
      window.location.hash = created ? `#/circle/${created.id}/new` : "#/";
    } catch (e) {
      setNotice({ kind: "error", text: explainError(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="page page--narrow">
      <a className="back" href="#circles">Back to circles</a>
      <h1>Start a circle</h1>
      <p className="lede">You'll be the first member. Others join from the circle's page, and it starts once every seat is taken.</p>
      <form className="form" onSubmit={submit}>
        <label>
          <span>Circle name</span>
          <input value={name} maxLength={64} required placeholder="Ikeja traders" onChange={(e) => setName(e.target.value)} />
        </label>
        <fieldset className="currency">
          <legend>Save in</legend>
          <div className="currency__opts">
            {CURRENCIES.map((c) => (
              <label key={c.symbol} className={`currency__opt${cur.symbol === c.symbol ? " is-on" : ""}`}>
                <input type="radio" name="currency" checked={cur.symbol === c.symbol} onChange={() => pickCurrency(c)} />
                <strong>{c.symbol}</strong>
                <span>{c.id ? `${c.name}, a dollar test stablecoin` : "Native NEAR"}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <label>
          <span>Each payment, in {cur.symbol}</span>
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
            Each member locks <strong>{fmt(yocto)}</strong> as a deposit, then pays{" "}
            <strong>{fmt(yocto)}</strong> {periodText}. Each round, one member collects{" "}
            <strong>{fmt(times(yocto, members))}</strong>. The circle runs {members} rounds.
          </p>
        )}

        {account && yocto && cur.id && (
          <PayWith token={cur.id} amount={yocto} value={payWith} onChange={setPayWith} balances={balances} />
        )}

        <button className="btn btn--primary btn--big" disabled={busy || (!!account && (!yocto || !name.trim()))}>
          {!account ? "Connect wallet to continue" : busy ? "Waiting for your wallet…" : `Create circle and lock ${yocto ? fmt(yocto) : ""}`}
        </button>
      </form>
      {account && <Wallet account={account} balances={balances} reload={reload} setNotice={setNotice} />}
    </section>
  );
}

// ---------------------------------------------------------------- detail

function CircleDetail({ id, fresh, account, signIn, setNotice, onChanged }: {
  id: number; fresh?: boolean; account: string | null; signIn: () => void; setNotice: (n: Notice) => void; onChanged: () => Promise<void>;
}) {
  const [c, setC] = useState<Circle | null | undefined>(undefined);
  const [busy, setBusy] = useState<string | null>(null);
  const [payWith, setPayWith] = useState<Currency | null>(null);
  const { balances, reload } = useBalances(account);
  const now = useNow();

  const load = useCallback(() => getCircle(id).then(setC).catch(() => setC(null)), [id]);
  useEffect(() => {
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [load]);

  if (c === undefined) return <section className="page"><p className="empty">Loading circle…</p></section>;
  if (c === null) return <section className="page"><a className="back" href="#circles">Back to circles</a><p className="empty">There's no circle number {id}.</p></section>;

  const me = account ? c.members.findIndex((m) => m.account_id === account) : -1;
  const member = me >= 0 ? c.members[me] : null;
  const recipient = c.status === "Active" ? c.members[c.current_round] : null;
  const late = c.status === "Active" && now > c.round_deadline_ms;
  const pot = times(c.contribution, c.max_members);
  const fmt = (v: string) => money(v, c.token);
  const using = payWith ?? currencyOf(c.token);

  async function act(method: string, deposit: string, done: string) {
    if (!account) return signIn();
    setBusy(method);
    try {
      if (method === "join_circle" || method === "contribute") {
        await payIn(c!.token ?? null, using, deposit, { action: method === "join_circle" ? "join" : "contribute", circle_id: id });
      } else {
        await call(method, { circle_id: id }, "0");
      }
      await load();
      await onChanged();
      reload();
      setNotice({ kind: "ok", text: done });
    } catch (e) {
      setNotice({ kind: "error", text: explainError(e) });
    } finally {
      setBusy(null);
    }
  }

  const payChoice = account && c.token ? (
    <PayWith token={c.token} amount={c.status === "Open" ? c.deposit : c.contribution} value={using} onChange={setPayWith} balances={balances} />
  ) : null;

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
      <>
        {payChoice}
        <button className="btn btn--primary btn--big" disabled={!!busy} onClick={() => act("join_circle", c.deposit, "You joined the circle.")}>
          {!account ? "Connect wallet to join" : busy ? "Waiting for your wallet…" : `Join and lock ${fmt(c.deposit)} deposit`}
        </button>
      </>
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
        <>
          {payChoice}
          <button className="btn btn--primary btn--big" disabled={!!busy} onClick={() => act("contribute", c.contribution, "Payment sent. Thank you for paying on time.")}>
            {busy ? "Waiting for your wallet…" : `Pay ${fmt(c.contribution)} for round ${c.current_round + 1}`}
          </button>
        </>
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
      <a className="back" href="#circles">Back to circles</a>
      <div className="detail__grid">
        <div className="detail__ring">
          <Ring circle={c} me={account} />
          {c.status === "Active" && <Legend />}
          <IyaAjo circle={c} account={account} now={now} />
        </div>
        <div className="detail__side">
          <h1>{c.name}</h1>
          <p className="terms">
            <strong>{fmt(c.contribution)}</strong> {periodLabel(c.period_minutes)}, {c.max_members} members.
            Each payout is <strong>{fmt(pot)}</strong>.
            {c.min_trust_score > 0 && <> Members need a trust score of {c.min_trust_score} or more.</>}
          </p>

          {c.status === "Active" && recipient && (
            <div className="turn">
              <span className="turn__who">{recipient.account_id === account ? "You collect" : `${shortAccount(recipient.account_id)} collects`} this round</span>
              <span className={`turn__clock${late ? " turn__clock--late" : ""}`}>{timeLeft(c.round_deadline_ms, now)}</span>
            </div>
          )}

          {c.status === "Open" && fresh && member && (
            <p className="state state--ok">Your circle is ready. Send the invite link below to the people you save with.</p>
          )}

          <div className="action">{action}</div>

          {account && member && c.status !== "Completed" && c.token && (
            <Wallet account={account} balances={balances} reload={reload} setNotice={setNotice} />
          )}

          <Reminders circle={c} now={now} />

          {c.status !== "Completed" && <Invite circle={c} highlight={c.status === "Open"} />}

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
                    <span>Round {h.round}: <strong>{fmt(h.amount)}</strong> to {shortAccount(h.recipient)}</span>
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

// ---------------------------------------------------------------- invite

function inviteText(c: Circle): string {
  const seats = c.max_members - c.members.length;
  return c.status === "Open"
    ? `Join my ajo "${c.name}" on NEAR: ${money(c.contribution, c.token)} ${periodLabel(c.period_minutes)}, ${c.max_members} members, ${seats} seat${seats === 1 ? "" : "s"} left. The contract holds the money and pays each of us in turn.`
    : `Follow our ajo "${c.name}" on NEAR: ${money(c.contribution, c.token)} ${periodLabel(c.period_minutes)}, round ${c.current_round + 1} of ${c.max_members}.`;
}

function Invite({ circle, highlight }: { circle: Circle; highlight: boolean }) {
  const url = `${window.location.origin}/#/circle/${circle.id}`;
  const text = inviteText(circle);
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const el = document.getElementById(`invite-${circle.id}`) as HTMLInputElement | null;
      el?.select();
      document.execCommand?.("copy");
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  const canShare = typeof navigator !== "undefined" && "share" in navigator;

  return (
    <div className={`invite${highlight ? " invite--open" : ""}`}>
      <h2 className="invite__title">{circle.status === "Open" ? "Invite people to join" : "Share this circle"}</h2>
      <p className="invite__text">
        {circle.status === "Open"
          ? `${circle.max_members - circle.members.length} seat${circle.max_members - circle.members.length === 1 ? "" : "s"} left. Anyone with this link can open the circle and join from their NEAR wallet.`
          : "Members and friends can follow every payment and payout on this page."}
      </p>
      <div className="invite__link">
        <input id={`invite-${circle.id}`} readOnly value={url} aria-label="Invite link" onFocus={(e) => e.currentTarget.select()} />
        <button className="btn btn--primary" onClick={copy}>{copied ? "Copied" : "Copy link"}</button>
      </div>
      <div className="invite__share">
        <a className="btn btn--line" href={`https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`} target="_blank" rel="noreferrer">Share on WhatsApp</a>
        <a className="btn btn--line" href={`https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`} target="_blank" rel="noreferrer">Post on X</a>
        {canShare && (
          <button className="btn btn--line" onClick={() => navigator.share({ title: circle.name, text, url }).catch(() => {})}>More options</button>
        )}
      </div>
    </div>
  );
}
