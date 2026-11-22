/**
 * Pool time-series charts (recharts), in privacy-pool terms: anonymity set growth,
 * deposits and withdrawals, pool balance. One measure per chart, one y-axis,
 * crosshair tooltip, text in text tokens, amounts in ETH. Deposits and withdrawals
 * use the validated --flow-in / --flow-out pair (pools.css).
 */
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipProps } from "recharts";
import { ethAmount, ethNumber, plural } from "./format";

export interface ChartPoint {
  t: number;
  tvl: bigint;
  deposited: bigint;
  exited: bigint;
  members: number;
  count: number;
}

export type ChartKind = "anonymity" | "activity" | "balance";

function timeLabel(t: number, span: number) {
  const d = new Date(t * 1000);
  if (span <= 86_400) return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const AXIS = { fontSize: 12, fill: "var(--muted-foreground)", fontFamily: "JetBrains Mono, ui-monospace, monospace" };

function Frame({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-border/70 bg-popover px-3 py-2 text-xs shadow-xl">{children}</div>;
}

export default function PoolChart({ kind, points, span }: { kind: ChartKind; points: ChartPoint[]; span: number }) {
  const data = points.map((p) => ({
    t: p.t,
    tvl: ethNumber(p.tvl),
    deposited: ethNumber(p.deposited),
    withdrawn: -ethNumber(p.exited),
    members: p.members,
    raw: p,
  }));
  const fmtEth = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 3 });

  const tooltip = (props: TooltipProps<number, string>) => {
    const p = props.payload?.[0]?.payload as (typeof data)[number] | undefined;
    if (!props.active || !p) return null;
    const when = new Date(p.t * 1000).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    return (
      <Frame>
        <p className="mb-1 font-mono text-xs text-muted-foreground">until {when}</p>
        {kind === "anonymity" && <p className="font-mono text-foreground">{plural(p.members, "deposit")} to hide among</p>}
        {kind === "balance" && <p className="font-mono text-foreground">{ethAmount(p.raw.tvl)} in the pool</p>}
        {kind === "activity" && (
          <div className="space-y-0.5 font-mono">
            <p className="flex items-center gap-2 text-foreground">
              <span className="h-2 w-2 rounded-sm" style={{ background: "var(--flow-in)" }} aria-hidden /> Deposited {ethAmount(p.raw.deposited)}
            </p>
            <p className="flex items-center gap-2 text-foreground">
              <span className="h-2 w-2 rounded-sm" style={{ background: "var(--flow-out)" }} aria-hidden /> Withdrawn {ethAmount(p.raw.exited)}
            </p>
            <p className="text-muted-foreground">{plural(p.raw.count, "transaction")}</p>
          </div>
        )}
      </Frame>
    );
  };

  const common = {
    data,
    margin: { top: 8, right: 8, bottom: 0, left: 0 },
  };
  const xAxis = (
    <XAxis
      dataKey="t"
      type="number"
      domain={["dataMin", "dataMax"]}
      tickFormatter={(t: number) => timeLabel(t, span)}
      tick={AXIS}
      tickLine={false}
      axisLine={{ stroke: "var(--border)" }}
      minTickGap={48}
    />
  );
  const grid = <CartesianGrid vertical={false} stroke="var(--border)" strokeOpacity={0.5} strokeDasharray="2 4" />;
  const cursor = { stroke: "var(--muted-foreground)", strokeWidth: 1, strokeDasharray: "3 3" };

  return (
    <ResponsiveContainer width="100%" height="100%">
      {kind === "activity" ? (
        <BarChart {...common} barCategoryGap={2} stackOffset="sign">
          {grid}
          {xAxis}
          <YAxis tick={AXIS} tickLine={false} axisLine={false} width={56} tickFormatter={fmtEth} />
          <ReferenceLine y={0} stroke="var(--border)" />
          <Tooltip content={tooltip} cursor={{ fill: "var(--muted)", opacity: 0.35 }} />
          <Bar dataKey="deposited" stackId="f" fill="var(--flow-in)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
          <Bar dataKey="withdrawn" stackId="f" fill="var(--flow-out)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
        </BarChart>
      ) : (
        <AreaChart {...common}>
          <defs>
            <linearGradient id="pool-area" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.32} />
              <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
            </linearGradient>
          </defs>
          {grid}
          {xAxis}
          <YAxis
            tick={AXIS}
            tickLine={false}
            axisLine={false}
            width={56}
            allowDecimals={kind !== "anonymity"}
            tickFormatter={kind === "anonymity" ? (v: number) => String(v) : fmtEth}
          />
          <Tooltip content={tooltip} cursor={cursor} />
          <Area
            type={kind === "anonymity" ? "stepAfter" : "monotone"}
            dataKey={kind === "anonymity" ? "members" : "tvl"}
            stroke="var(--primary)"
            strokeWidth={2}
            fill="url(#pool-area)"
            activeDot={{ r: 4, stroke: "var(--background)", strokeWidth: 2, fill: "var(--primary)" }}
            isAnimationActive={false}
          />
        </AreaChart>
      )}
    </ResponsiveContainer>
  );
}
