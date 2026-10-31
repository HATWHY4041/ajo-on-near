import { Circle, fromYocto, initials, shortAccount, times } from "./near";

type SeatState = "collecting" | "paid" | "waiting" | "collected" | "empty";

const SIZE = 400;
const C = SIZE / 2;
const R = 148;

function seatState(c: Circle, i: number): SeatState {
  const m = c.members[i];
  if (!m) return "empty";
  if (c.status === "Completed") return "collected";
  if (c.status === "Open") return "waiting";
  if (i === c.current_round) return "collecting";
  if (m.paid_this_round) return "paid";
  return "waiting";
}

const stateLabel: Record<SeatState, string> = {
  collecting: "collects this round",
  paid: "paid this round",
  waiting: "not paid yet",
  collected: "has collected",
  empty: "empty seat",
};

/** The circle itself: one seat per member in payout order, the pot in the middle. */
export function Ring({ circle, me, size = "large" }: { circle: Circle; me?: string | null; size?: "large" | "small" }) {
  const n = circle.max_members;
  const seatR = Math.min(30, Math.max(14, R * Math.sin(Math.PI / n) * 0.78));
  const angle = (i: number) => (i / n) * Math.PI * 2 - Math.PI / 2;
  const active = circle.status === "Active";
  const turnDeg = (circle.current_round / n) * 360;
  const potFull = times(circle.contribution, circle.members.length || n);
  const paidCount = circle.members.filter((m) => m.paid_this_round).length;

  let centerTop: string;
  let centerBottom: string[];
  if (circle.status === "Open") {
    centerTop = `${circle.members.length} of ${n}`;
    centerBottom = ["seats taken"];
  } else if (circle.status === "Active") {
    centerTop = `${fromYocto(potFull)} NEAR`;
    centerBottom = [`round ${circle.current_round + 1} of ${n}`, `${paidCount} of ${circle.members.length} paid`];
  } else {
    centerTop = "Complete";
    centerBottom = [`${n} payouts made`];
  }

  return (
    <figure className={`ring ring--${size}`}>
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={`${circle.name}: ${centerTop}, ${centerBottom.join(", ")}`}>
        <circle className="ring__track" cx={C} cy={C} r={R} />
        {active && (
          <g className="ring__turn" style={{ ["--turn" as string]: `${turnDeg}deg` }}>
            <line x1={C} y1={C - 78} x2={C} y2={C - R + seatR + 8} />
            <circle cx={C} cy={C - R} r={seatR + 7} className="ring__halo" />
          </g>
        )}
        <circle className="ring__pot" cx={C} cy={C} r={74} />
        <text className="ring__pot-top" x={C} y={C + (centerBottom.length > 1 ? -4 : 4)} textAnchor="middle">{centerTop}</text>
        {centerBottom.map((line, i) => (
          <text key={i} className="ring__pot-bottom" x={C} y={C + (centerBottom.length > 1 ? 20 : 28) + i * 18} textAnchor="middle">{line}</text>
        ))}
        {Array.from({ length: n }, (_, i) => {
          const a = angle(i);
          const x = C + R * Math.cos(a);
          const y = C + R * Math.sin(a);
          const m = circle.members[i];
          const st = seatState(circle, i);
          const mine = m && me && m.account_id === me;
          return (
            <g key={i} className={`seat seat--${st}${mine ? " seat--me" : ""}`}>
              <title>{m ? `${shortAccount(m.account_id)}: ${stateLabel[st]}` : "Empty seat"}</title>
              <circle cx={x} cy={y} r={seatR} />
              {m && (
                <text x={x} y={y + seatR * 0.18} textAnchor="middle" style={{ fontSize: seatR * 0.62 }}>
                  {initials(m.account_id)}
                </text>
              )}
              {st === "paid" && <path className="seat__tick" d={`M${x + seatR * 0.45} ${y - seatR * 0.95} l4 4 l8 -9`} />}
            </g>
          );
        })}
      </svg>
    </figure>
  );
}
