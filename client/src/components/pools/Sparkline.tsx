import { useId } from "react";

/**
 * Trend: pool-balance sparkline (area) with a tick per slice underneath, in the
 * flow palette (pools.css): --flow-in where more was deposited than withdrawn,
 * --flow-out for the reverse. Not gain/loss colours: a pool balance is nobody's profit.
 * Pure SVG; colours come from design tokens so both themes work.
 */
export default function Sparkline({
  series,
  flows,
  width = 132,
  height = 40,
  className,
}: {
  series: string[];
  flows?: string[];
  width?: number;
  height?: number;
  className?: string;
}) {
  const id = useId().replace(/:/g, "");
  const values = series.map(Number);
  const flowValues = (flows ?? []).map(Number);
  const flat = values.every((v) => v === values[0]);
  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const areaH = height - 8;
  const step = values.length > 1 ? width / (values.length - 1) : width;
  const pts = values.map((v, i) => [i * step, flat ? areaH / 2 : areaH - ((v - min) / span) * (areaH - 4) - 2] as const);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${width},${areaH} L0,${areaH} Z`;
  const flowMax = Math.max(...flowValues.map(Math.abs), 0) || 1;
  const barW = width / Math.max(1, flowValues.length);

  // nothing held over the whole interval (a new pool): a faint baseline, not a filled band over nothing
  if (values.length === 0 || values.every((v) => v === 0)) {
    return (
      <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} className={className} aria-hidden>
        <path d={`M0,${areaH - 1} L${width},${areaH - 1}`} stroke="var(--muted-foreground)" strokeWidth="1" strokeDasharray="3 4" opacity={0.5} />
      </svg>
    );
  }

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} className={className} aria-hidden>
      <defs>
        <linearGradient id={`g${id}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.35" />
          <stop offset="100%" stopColor="var(--primary)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#g${id})`} />
      <path d={line} fill="none" stroke="var(--primary)" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" opacity={flat ? 0.45 : 1} />
      {flowValues.map((v, i) =>
        v === 0 ? null : (
          <rect
            key={i}
            x={i * barW + barW * 0.2}
            width={barW * 0.6}
            y={height - 6}
            height={Math.max(1.5, (Math.abs(v) / flowMax) * 5)}
            rx={0.6}
            fill={v > 0 ? "var(--flow-in)" : "var(--flow-out)"}
            opacity={0.85}
          />
        ),
      )}
    </svg>
  );
}
