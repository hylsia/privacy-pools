/**
 * Deterministic geometry for the scene art: a seeded PRNG, a smooth spline
 * through points, ridge profiles and scalloped cloud edges. Everything here is
 * pure and seeded, so the art is identical on every render and every device.
 * Paths are written in a 1600-unit-wide space (see SCENE_W).
 */

/** Width of the drawing space every full-bleed scene SVG uses (viewBox 0 0 1600 H). */
export const SCENE_W = 1600;

/** Seeded PRNG (mulberry32): the same seed gives the same sequence everywhere. */
export function rng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Pt = readonly [number, number];

const r1 = (v: number) => Math.round(v * 10) / 10;

/**
 * A smooth curve through every point (uniform Catmull-Rom written as cubic
 * Béziers). `tension` 1 is the classic spline; lower is tighter.
 * Returns path commands starting with "M".
 */
export function splinePath(points: readonly Pt[], tension = 1): string {
  if (points.length < 2) return "";
  return `M${r1(points[0][0])} ${r1(points[0][1])}${splineSegments(points, tension).join("")}`;
}

/** The spline's cubic segments: segment i runs from point i to point i + 1 ("C …" commands). */
function splineSegments(points: readonly Pt[], tension: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const c1x = p1[0] + ((p2[0] - p0[0]) / 6) * tension;
    const c1y = p1[1] + ((p2[1] - p0[1]) / 6) * tension;
    const c2x = p2[0] - ((p3[0] - p1[0]) / 6) * tension;
    const c2y = p2[1] - ((p3[1] - p1[1]) / 6) * tension;
    out.push(`C${r1(c1x)} ${r1(c1y)} ${r1(c2x)} ${r1(c2y)} ${r1(p2[0])} ${r1(p2[1])}`);
  }
  return out;
}

export interface RidgeProfileOptions {
  /** number of summits across the width */
  peaks: number;
  /** y of the valleys (viewBox units, grows downwards) */
  base: number;
  /** height of the tallest summit above the base */
  amp: number;
  /** drawing width (default SCENE_W) */
  width?: number;
}

export interface RidgeShapes {
  /** the open ridge line, for a faint rim along the whole crest */
  crest: string;
  /** the closed silhouette down to `bottom` */
  fill: string;
  /** per summit: the moonlit face (closed) and its lit crest edge (open) */
  faces: { face: string; edge: string }[];
}

/**
 * A mountain ridge line: valleys and summits alternate, each summit flanked by
 * two shoulders set close in, so it reads as a peak rather than a hill, all
 * joined by one smooth spline. Each summit also gets its moonlit face: the
 * slope on the `lit` side, from the crest down to an inner spine.
 */
export function ridgePaths(
  seed: number,
  opts: RidgeProfileOptions,
  bottom: number,
  lit: "right" | "left" = "right",
): RidgeShapes {
  const rand = rng(seed);
  const width = opts.width ?? SCENE_W;
  const span = width + 240;
  const step = span / (opts.peaks * 2);
  const pts: Pt[] = [];
  const summits: number[] = [];
  // one summit stands clearly above the rest
  const hero = 1 + Math.floor(rand() * opts.peaks);
  for (let i = 0; i <= opts.peaks * 2; i++) {
    const x = -120 + i * step + (i > 0 && i < opts.peaks * 2 ? (rand() - 0.5) * step * 0.5 : 0);
    if (i % 2 === 1) {
      const h = opts.amp * ((i + 1) / 2 === hero ? 0.94 + rand() * 0.06 : 0.42 + rand() * 0.42);
      const lean = (rand() - 0.5) * step * 0.3;
      pts.push([x - step * (0.24 + rand() * 0.1) + lean, opts.base - h * (0.66 + rand() * 0.1)]);
      summits.push(pts.length);
      pts.push([x + lean, opts.base - h]);
      pts.push([x + step * (0.22 + rand() * 0.1) + lean, opts.base - h * (0.62 + rand() * 0.12)]);
    } else {
      pts.push([x, opts.base - opts.amp * (0.03 + rand() * 0.14)]);
    }
  }
  const tension = 0.82;
  const segs = splineSegments(pts, tension);
  const crest = `M${r1(pts[0][0])} ${r1(pts[0][1])}${segs.join("")}`;
  const first = pts[0];
  const last = pts[pts.length - 1];
  const fill = `${crest}L${r1(last[0])} ${bottom}L${r1(first[0])} ${bottom}Z`;

  const foot = opts.base + 30;
  const faces = summits.map((s) => {
    const S = pts[s];
    if (lit === "right") {
      // crest: summit → shoulder → valley; then down, and back up the spine
      const V = pts[s + 2];
      const edge = `M${r1(S[0])} ${r1(S[1])}${segs[s]}${segs[s + 1]}`;
      const spineX = S[0] + (V[0] - S[0]) * 0.2;
      const face = `${edge}L${r1(V[0])} ${foot}L${r1(spineX + (V[0] - S[0]) * 0.12)} ${foot}Q${r1(spineX)} ${r1(S[1] + (foot - S[1]) * 0.45)} ${r1(S[0])} ${r1(S[1])}Z`;
      return { face, edge };
    }
    // left: valley → shoulder → summit along the crest, then down the spine
    const V = pts[s - 2];
    const edge = `M${r1(V[0])} ${r1(V[1])}${segs[s - 2]}${segs[s - 1]}`;
    const spineX = S[0] - (S[0] - V[0]) * 0.2;
    const face = `${edge}Q${r1(spineX)} ${r1(S[1] + (foot - S[1]) * 0.45)} ${r1(spineX - (S[0] - V[0]) * 0.12)} ${foot}L${r1(V[0])} ${foot}Z`;
    return { face, edge };
  });
  return { crest, fill, faces };
}

export interface ScallopOptions {
  /** mean y of the edge (viewBox units) */
  y: number;
  /** how far the edge wanders up and down around `y` */
  swell: number;
  /** narrowest and widest puff (viewBox units) */
  minW: number;
  maxW: number;
  /** drawing width (default SCENE_W) */
  width?: number;
}

/**
 * A scalloped cloud edge: a run of round puffs, joined by circular arcs, whose
 * line rises and falls in long swells. `edge: "top"` bulges upwards (a deck seen
 * from above, filled down to `far`); `edge: "bottom"` bulges downwards (the
 * underside of a deck, filled up to `far`). Returns the open edge (for the rim)
 * and the closed shape (for the fill).
 */
export function scallopPaths(
  seed: number,
  opts: ScallopOptions,
  edge: "top" | "bottom",
  far: number,
): { edge: string; fill: string } {
  const rand = rng(seed);
  const width = opts.width ?? SCENE_W;
  const phase = rand() * Math.PI * 2;
  const phase2 = rand() * Math.PI * 2;
  const dir = edge === "top" ? -1 : 1;
  const swellAt = (x: number) =>
    Math.sin((x / width) * Math.PI * 2.2 + phase) * 0.65 + Math.sin((x / width) * Math.PI * 5.1 + phase2) * 0.35;
  const pts: Pt[] = [];
  let x = -80 - rand() * 60;
  while (x < width + 80) {
    pts.push([x, opts.y + dir * swellAt(x) * opts.swell + (rand() - 0.5) * opts.swell * 0.35]);
    x += opts.minW + rand() * (opts.maxW - opts.minW);
  }
  pts.push([x, opts.y + dir * swellAt(x) * opts.swell]);

  // left to right for a top edge (sweep 1 bulges up), right to left for an underside (sweep 1 bulges down)
  const run = edge === "top" ? pts : [...pts].reverse();
  let line = `M${r1(run[0][0])} ${r1(run[0][1])}`;
  for (let i = 1; i < run.length; i++) {
    const [ax, ay] = run[i - 1];
    const [bx, by] = run[i];
    const chord = Math.hypot(bx - ax, by - ay);
    const r = (chord / 2) * (1.02 + rand() * 0.3);
    line += `A${r1(r)} ${r1(r)} 0 0 1 ${r1(bx)} ${r1(by)}`;
  }
  const a = run[0];
  const b = run[run.length - 1];
  const fill = `${line}L${r1(b[0])} ${far}L${r1(a[0])} ${far}Z`;
  return { edge: line, fill };
}

export interface IslandOptions {
  /** centre and half-width of the bank */
  cx: number;
  cy: number;
  rx: number;
  /** how high the puffs heap above cy, and how far the underside hangs below it */
  top: number;
  bottom: number;
  /** narrowest and widest puff */
  minW: number;
  maxW: number;
}

/**
 * A floating cloud bank: a dome of puffs on top, smaller billows underneath,
 * tapering to points at both ends. Returns the closed shape and its top edge.
 */
export function islandPaths(seed: number, o: IslandOptions): { fill: string; edge: string } {
  const rand = rng(seed);
  const run = (n: number) => {
    const w = Array.from({ length: n }, () => o.minW + rand() * (o.maxW - o.minW));
    const sum = w.reduce((a, b) => a + b, 0);
    let x = o.cx - o.rx;
    return [x, ...w.map((v) => (x += (v / sum) * o.rx * 2))];
  };
  const dome = (x: number) => Math.sqrt(Math.max(0, 1 - ((x - o.cx) / o.rx) ** 2));
  const n = Math.max(3, Math.round((o.rx * 2) / ((o.minW + o.maxW) / 2)));

  const topXs = run(n);
  const top: Pt[] = topXs.map((x, i) =>
    i === 0 || i === topXs.length - 1 ? [x, o.cy] : [x, o.cy - o.top * dome(x) ** 0.7 * (0.82 + rand() * 0.18)],
  );
  const bottomXs = run(Math.max(3, n - 1)).reverse();
  const bottom: Pt[] = bottomXs.map((x, i) =>
    i === 0 || i === bottomXs.length - 1 ? [x, o.cy] : [x, o.cy + o.bottom * dome(x) ** 0.9 * (0.75 + rand() * 0.25)],
  );

  const arcs = (pts: Pt[], bulge: number) => {
    let d = "";
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1];
      const [bx, by] = pts[i];
      const r = (Math.hypot(bx - ax, by - ay) / 2) * (bulge + rand() * 0.25);
      d += `A${r1(r)} ${r1(r)} 0 0 1 ${r1(bx)} ${r1(by)}`;
    }
    return d;
  };
  const edge = `M${r1(top[0][0])} ${r1(top[0][1])}${arcs(top, 1.02)}`;
  const fill = `${edge}${arcs(bottom, 1.15)}Z`;
  return { fill, edge };
}

/** n points scattered over a box, seeded; for sparkles and star clusters. */
export function scatter(
  seed: number,
  n: number,
  box: { x0: number; y0: number; x1: number; y1: number },
): { x: number; y: number; t: number }[] {
  const rand = rng(seed);
  return Array.from({ length: n }, () => ({
    x: box.x0 + rand() * (box.x1 - box.x0),
    y: box.y0 + rand() * (box.y1 - box.y0),
    t: rand(),
  }));
}
