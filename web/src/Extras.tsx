import { useCallback, useEffect, useRef, useState } from "react";
import {
  CURRENCIES, Circle, Currency, NEAR, PAY_OPTIONS, TEST_RATE, TUSDC, TUSDT, Trust, USDC, WNEAR, balanceOf, costIn, currencyOf,
  explainError, faucet, fromUnits, getTrust, money, periodLabel, shortAccount, timeLeft, times, wrapNear,
} from "./near";

type Notice = { kind: "ok" | "error"; text: string } | null;

// ---------------------------------------------------------------- balances

const BALANCE_LIST = [NEAR, USDC, TUSDT, WNEAR, TUSDC];

export function useBalances(account: string | null) {
  const [balances, setBalances] = useState<Record<string, string>>({});
  const load = useCallback(async () => {
    if (!account) return setBalances({});
    const entries = await Promise.all(
      BALANCE_LIST.map(async (c) => [c.symbol, await balanceOf(c, account).catch(() => "0")] as const),
    );
    setBalances(Object.fromEntries(entries));
  }, [account]);
  useEffect(() => {
    load();
    const t = setInterval(load, 12000);
    return () => clearInterval(t);
  }, [load]);
  return { balances, reload: load };
}

/** Testnet balances of everything you can pay with, and where to get more. */
export function Wallet({ account, balances, reload, setNotice }: {
  account: string; balances: Record<string, string>; reload: () => Promise<void>; setNotice: (n: Notice) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  async function run(sym: string, fn: () => Promise<unknown>, done: string) {
    setBusy(sym);
    try {
      await fn();
      await reload();
      setNotice({ kind: "ok", text: done });
    } catch (e) {
      setNotice({ kind: "error", text: explainError(e) });
    } finally {
      setBusy(null);
    }
  }
  const action = (cur: Currency) => {
    if (cur === NEAR) return <a className="btn btn--line btn--small" href="https://near-faucet.io/" target="_blank" rel="noreferrer">NEAR faucet</a>;
    if (cur === USDC) return <a className="btn btn--line btn--small" href="https://faucet.circle.com/" target="_blank" rel="noreferrer" title="Pick Near Testnet and paste your account">Get 20 USDC</a>;
    if (cur === WNEAR) return (
      <button className="btn btn--line btn--small" disabled={!!busy} onClick={() => run(cur.symbol, wrapNear, "Wrapped 1 NEAR into wNEAR.")}>
        {busy === cur.symbol ? "Waiting…" : "Wrap 1 NEAR"}
      </button>
    );
    return (
      <button className="btn btn--line btn--small" disabled={!!busy} onClick={() => run(cur.symbol, () => faucet(cur.id!), `100 ${cur.symbol} added to ${shortAccount(account)}.`)}>
        {busy === cur.symbol ? "Waiting…" : `Get 100 ${cur.symbol}`}
      </button>
    );
  };
  const shown = PAY_OPTIONS.concat(balances.tUSDC && balances.tUSDC !== "0" ? [TUSDC] : []);
  return (
    <div className="wallet" aria-label="Your testnet balances">
      <div className="wallet__head">
        <h2>Your testnet balances</h2>
        <span className="wallet__note">Testnet only, no real value</span>
      </div>
      <ul className="wallet__list">
        {shown.map((cur) => (
          <li key={cur.symbol}>
            <span className="wallet__amt">{balances[cur.symbol] !== undefined ? fromUnits(balances[cur.symbol], cur.decimals, 2) : "…"}</span>
            <span className="wallet__sym">{cur.symbol}</span>
            {action(cur)}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------- pay with

function rateNote(cur: Currency) {
  if (cur === WNEAR) return "Unwrapped 1:1 to NEAR";
  return `Converted to NEAR at 1 NEAR = ${TEST_RATE} ${cur.symbol}`;
}

/** Choose what to pay a circle with. NEAR circles take NEAR or any listed token, converted to NEAR on the way. */
export function PayWith({ token, amount, value, onChange, balances }: {
  token: string | null; amount: string; value: Currency; onChange: (c: Currency) => void; balances: Record<string, string>;
}) {
  const circleCur = currencyOf(token);
  const options = token ? [circleCur, ...CURRENCIES.filter((c) => c.symbol !== circleCur.symbol)] : PAY_OPTIONS;
  const [costs, setCosts] = useState<Record<string, string>>({});
  useEffect(() => {
    let live = true;
    Promise.all(options.map(async (c) => [c.symbol, await costIn(token, c, amount).catch(() => "")] as const))
      .then((e) => live && setCosts(Object.fromEntries(e)));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, amount]);
  return (
    <fieldset className="paywith">
      <legend>Pay with</legend>
      <div className={`paywith__opts${options.length > 3 ? " paywith__opts--4" : ""}`}>
        {options.map((cur) => {
          const c = costs[cur.symbol];
          const cost = c ? `${fromUnits(c, cur.decimals, cur.decimals > 6 ? 4 : 2)} ${cur.symbol}` : "…";
          const note = token
            ? (cur.id === token ? "Direct" : cur.id ? "Swapped 1:1" : `At test rate 1 NEAR = ${TEST_RATE} ${circleCur.symbol}`)
            : (cur.id ? rateNote(cur) : "Direct");
          const bal = balances[cur.symbol];
          return (
            <label key={cur.symbol} className={`paywith__opt${value.symbol === cur.symbol ? " is-on" : ""}`}>
              <input type="radio" name="paywith" checked={value.symbol === cur.symbol} onChange={() => onChange(cur)} />
              <span className="paywith__sym">{cur.symbol}</span>
              <span className="paywith__cost">{cost}</span>
              <span className="paywith__note">{note}{bal !== undefined && ` · you have ${fromUnits(bal, cur.decimals, 2)}`}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

// ---------------------------------------------------------------- Iya Ajo

type Msg = { from: "you" | "iya"; text: string };

const QUESTIONS = [
  "When is my turn?",
  "How much do I pay?",
  "Who hasn't paid?",
  "When is the deadline?",
  "What if I miss a payment?",
  "What's my trust score?",
];

function answer(q: string, c: Circle, account: string | null, now: number, trust: Trust | null): string {
  const t = q.toLowerCase();
  const n = c.max_members;
  const me = account ? c.members.findIndex((m) => m.account_id === account) : -1;
  const pot = money(times(c.contribution, n), c.token);
  const each = money(c.contribution, c.token);
  const recipient = c.status === "Active" ? c.members[c.current_round] : null;
  const unpaid = c.status === "Active" ? c.members.filter((m) => !m.paid_this_round) : [];

  if (/turn|collect|when do i get|my money|payout|receive/.test(t)) {
    if (c.status === "Open") return `The order isn't drawn yet. When all ${n} seats are taken, the contract shuffles the order at random, and I'll tell you your round.`;
    if (c.status === "Completed") return "This circle is finished. Every member collected once and deposits were returned.";
    if (me < 0) return `${recipient ? shortAccount(recipient.account_id) : "Someone"} collects this round. Connect a member's wallet and I can tell you your own turn.`;
    if (me === c.current_round) return `It's your turn now. You collect ${pot} as soon as everyone pays for round ${c.current_round + 1}, or when the round is settled after the deadline.`;
    if (me < c.current_round) return `You already collected in round ${me + 1}. Keep paying until round ${n} so everyone gets their turn.`;
    return `You collect in round ${me + 1} of ${n}, which is ${me - c.current_round} round${me - c.current_round === 1 ? "" : "s"} from now. You'll get ${pot}.`;
  }
  if (/how much|amount|pay\b|cost|contribut|deposit/.test(t)) {
    return `Every member pays ${each} ${periodLabel(c.period_minutes)}, and locked ${money(c.deposit, c.token)} as a deposit when they joined. Each round, one member collects ${pot}.${c.token ? " You can pay with tUSDC, tUSDT or NEAR; the site converts it at the test rate in the same transaction." : " You can pay with NEAR, or with USDC, USDT or wNEAR: it's converted to NEAR in the same transaction, so you sign once."}`;
  }
  if (/who|hasn|not paid|unpaid|owe|late/.test(t)) {
    if (c.status !== "Active") return c.status === "Open" ? "Nobody pays yet. Payments start when the circle is full." : "Everyone is settled. The circle is complete.";
    if (!unpaid.length) return "Everyone has paid this round.";
    return `${unpaid.length} of ${c.members.length} still to pay for round ${c.current_round + 1}: ${unpaid.map((m) => m.account_id === account ? "you" : shortAccount(m.account_id)).join(", ")}. Use the reminder buttons to nudge them.`;
  }
  if (/deadline|when|time|due|left/.test(t)) {
    if (c.status !== "Active") return c.status === "Open" ? `There's no deadline yet. Once the circle starts, everyone pays ${periodLabel(c.period_minutes)}.` : "No more deadlines. The circle is complete.";
    const d = new Date(c.round_deadline_ms);
    return now > c.round_deadline_ms
      ? `The round ${c.current_round + 1} deadline passed at ${d.toLocaleString()}. Anyone can settle the round now.`
      : `Round ${c.current_round + 1} closes at ${d.toLocaleString()} (${timeLeft(c.round_deadline_ms, now).replace(" left", "")} from now). Add it to your calendar with the reminder below.`;
  }
  if (/miss|fail|can't pay|cannot pay|forget|settle/.test(t)) {
    return `If you miss the deadline, anyone can settle the round. Your ${each} is taken from your deposit so the person collecting still gets the full pot, and the miss goes on your trust record.`;
  }
  if (/trust|score|record|reputation/.test(t)) {
    if (!account) return "Connect your wallet and I'll read your trust score from the contract.";
    if (!trust) return "Let me check your record… ask me again in a second.";
    const total = trust.on_time_payments + trust.missed_payments;
    return total
      ? `Your trust score is ${trust.score}: ${trust.on_time_payments} on-time and ${trust.missed_payments} missed payments across ${trust.circles_completed} finished circle${trust.circles_completed === 1 ? "" : "s"}.${c.min_trust_score ? ` This circle needs ${c.min_trust_score}.` : ""}`
      : "You don't have a trust score yet. Finish a circle and paying on time builds it.";
  }
  if (/safe|scam|steal|run|trust the|creator/.test(t)) {
    return "Nobody holds the money but the contract. It can only pay the member whose turn it is and return deposits at the end. Not even the person who started the circle can take it.";
  }
  if (/hello|hi\b|hey|ẹ n|bawo/.test(t)) return "Ẹ n lẹ! I'm Iya Ajo. Ask me about your turn, payments, deadlines or your trust score.";
  return "I can answer: when is my turn, how much do I pay, who hasn't paid, when is the deadline, what if I miss, and what's my trust score.";
}

/** Iya Ajo: the circle's assistant, answering from live circle data. */
export function IyaAjo({ circle, account, now }: { circle: Circle; account: string | null; now: number }) {
  const [msgs, setMsgs] = useState<Msg[]>([
    { from: "iya", text: `Ẹ n lẹ! I'm Iya Ajo, this circle's helper. I read ${circle.name} straight from the contract. What would you like to know?` },
  ]);
  const [text, setText] = useState("");
  const [trust, setTrust] = useState<Trust | null>(null);
  const list = useRef<HTMLOListElement>(null);

  useEffect(() => { if (account) getTrust(account).then(setTrust).catch(() => {}); }, [account]);
  useEffect(() => { list.current?.scrollTo({ top: list.current.scrollHeight, behavior: "smooth" }); }, [msgs]);

  function ask(q: string) {
    if (!q.trim()) return;
    setMsgs((m) => [...m, { from: "you", text: q.trim() }, { from: "iya", text: answer(q, circle, account, now, trust) }]);
    setText("");
  }

  return (
    <div className="iya" aria-label="Iya Ajo assistant">
      <div className="iya__head">
        <span className="iya__face" aria-hidden="true">IA</span>
        <div>
          <h2>Ask Iya Ajo</h2>
          <p>Answers come from this circle's live record on NEAR.</p>
        </div>
      </div>
      <ol className="iya__log" ref={list} aria-live="polite">
        {msgs.map((m, i) => <li key={i} className={`iya__msg iya__msg--${m.from}`}>{m.text}</li>)}
      </ol>
      <div className="iya__chips">
        {QUESTIONS.map((q) => <button key={q} className="chip-btn" onClick={() => ask(q)}>{q}</button>)}
      </div>
      <form className="iya__form" onSubmit={(e) => { e.preventDefault(); ask(text); }}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Type a question" aria-label="Your question" />
        <button className="btn btn--primary">Ask</button>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------- reminders

function icsDate(ms: number) {
  return new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function makeIcs(c: Circle, url: string): string {
  const rounds = c.max_members - c.current_round;
  const period = c.period_minutes;
  const rule = period % 10080 === 0 ? `FREQ=WEEKLY;INTERVAL=${period / 10080}` : period % 1440 === 0 ? `FREQ=DAILY;INTERVAL=${period / 1440}`
    : period % 60 === 0 ? `FREQ=HOURLY;INTERVAL=${period / 60}` : `FREQ=MINUTELY;INTERVAL=${period}`;
  const before = period >= 2880 ? "-P1D" : period >= 120 ? "-PT1H" : "-PT1M";
  const start = c.round_deadline_ms - 15 * 60000;
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Ajo on NEAR//EN", "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:ajo-${c.id}-${c.round_deadline_ms}@ajo-on-near`,
    `DTSTAMP:${icsDate(Date.now())}`,
    `DTSTART:${icsDate(start)}`,
    `DTEND:${icsDate(c.round_deadline_ms)}`,
    `RRULE:${rule};COUNT=${rounds}`,
    `SUMMARY:Ajo payment due: ${c.name} (${money(c.contribution, c.token)})`,
    `DESCRIPTION:Pay ${money(c.contribution, c.token)} before the deadline. Later rounds can start earlier if everyone pays early. ${url}`,
    `URL:${url}`,
    "BEGIN:VALARM", "ACTION:DISPLAY", `TRIGGER:${before}`, `DESCRIPTION:Ajo payment due soon: ${c.name}`, "END:VALARM",
    "END:VEVENT", "END:VCALENDAR",
  ].join("\r\n");
}

/** Payment reminders: calendar alarm, group message on WhatsApp, or SMS. */
export function Reminders({ circle, now }: { circle: Circle; now: number }) {
  if (circle.status !== "Active") return null;
  const url = `${window.location.origin}/#/circle/${circle.id}`;
  const unpaid = circle.members.filter((m) => !m.paid_this_round).map((m) => shortAccount(m.account_id));
  const due = new Date(circle.round_deadline_ms).toLocaleString();
  const text = `Ajo reminder for "${circle.name}": round ${circle.current_round + 1} payment of ${money(circle.contribution, circle.token)} is due by ${due} (${timeLeft(circle.round_deadline_ms, now)}).${unpaid.length ? ` Still to pay: ${unpaid.join(", ")}.` : ""} Pay here: ${url}`;

  function download() {
    const blob = new Blob([makeIcs(circle, url)], { type: "text/calendar" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `ajo-${circle.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.ics`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  return (
    <div className="remind">
      <h2>Payment reminders</h2>
      <p className="remind__text">Round {circle.current_round + 1} is due by <strong>{due}</strong>. Set an alarm for yourself, or nudge the group.</p>
      <div className="remind__btns">
        <button className="btn btn--line" onClick={download}>Add to calendar</button>
        <a className="btn btn--line" href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer">Remind on WhatsApp</a>
        <a className="btn btn--line" href={`sms:?&body=${encodeURIComponent(text)}`}>Remind by SMS</a>
      </div>
    </div>
  );
}
