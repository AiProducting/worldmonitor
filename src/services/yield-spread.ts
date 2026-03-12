/**
 * F-31 — Yield Spread Analyzer
 *
 * Computes treasury yield curve spreads (2s10s, 3m10y),
 * credit spreads (IG, HY vs treasury), and derives a
 * recession probability signal from the yield curve.
 */

// ─── Types ──────────────────────────────────────────────────────

export interface YieldCurvePoint {
  tenor: string;          // e.g. '3m', '2y', '5y', '10y', '30y'
  yieldPct: number;       // annualised yield in %
}

export interface SpreadResult {
  name: string;           // e.g. '2s10s', '3m10y', 'IG-10y'
  spreadBps: number;      // spread in basis points
  inverted: boolean;      // true if short end > long end
}

export interface YieldCurveAnalysis {
  spreads: SpreadResult[];
  curveShape: 'normal' | 'flat' | 'inverted' | 'humped';
  recessionProbability: number;   // 0-100 %
  steepestSegment: string | null;
}

// ─── Helpers ────────────────────────────────────────────────────

const TENOR_ORDER: Record<string, number> = {
  '1m': 1/12, '3m': 0.25, '6m': 0.5,
  '1y': 1, '2y': 2, '3y': 3, '5y': 5,
  '7y': 7, '10y': 10, '20y': 20, '30y': 30,
};

function tenorYears(t: string): number {
  return TENOR_ORDER[t.toLowerCase()] ?? 0;
}

function findYield(pts: YieldCurvePoint[], tenor: string): number | null {
  const p = pts.find(p => p.tenor.toLowerCase() === tenor.toLowerCase());
  return p?.yieldPct ?? null;
}

// ─── Core ───────────────────────────────────────────────────────

/**
 * Compute a named spread between two tenors.
 */
export function computeSpread(
  points: YieldCurvePoint[],
  shortTenor: string,
  longTenor: string,
  name?: string,
): SpreadResult | null {
  const s = findYield(points, shortTenor);
  const l = findYield(points, longTenor);
  if (s == null || l == null) return null;
  const spreadBps = Math.round((l - s) * 100);
  return {
    name: name ?? `${shortTenor}-${longTenor}`,
    spreadBps,
    inverted: spreadBps < 0,
  };
}

/**
 * Classic 2s10s and 3m10y treasury spreads.
 */
export function treasurySpreads(curve: YieldCurvePoint[]): SpreadResult[] {
  const results: SpreadResult[] = [];
  const s2s10 = computeSpread(curve, '2y', '10y', '2s10s');
  if (s2s10) results.push(s2s10);
  const s3m10 = computeSpread(curve, '3m', '10y', '3m10y');
  if (s3m10) results.push(s3m10);
  return results;
}

/**
 * Credit spread: corporate yield minus risk-free tenor yield.
 */
export function creditSpread(
  corporateYieldPct: number,
  riskFreeCurve: YieldCurvePoint[],
  benchmarkTenor: string = '10y',
  name: string = 'credit',
): SpreadResult | null {
  const rf = findYield(riskFreeCurve, benchmarkTenor);
  if (rf == null) return null;
  const spreadBps = Math.round((corporateYieldPct - rf) * 100);
  return { name, spreadBps, inverted: spreadBps < 0 };
}

/**
 * Classify overall curve shape from a set of points.
 */
export function classifyCurveShape(points: YieldCurvePoint[]): YieldCurveAnalysis['curveShape'] {
  if (points.length < 3) return 'flat';
  const sorted = [...points].sort((a, b) => tenorYears(a.tenor) - tenorYears(b.tenor));
  const front = sorted[0]!.yieldPct;
  const back = sorted[sorted.length - 1]!.yieldPct;
  const mid = sorted[Math.floor(sorted.length / 2)]!.yieldPct;

  const diff = back - front;
  if (Math.abs(diff) < 0.15) return 'flat';
  if (mid > front && mid > back && mid - Math.min(front, back) > 0.2) return 'humped';
  if (diff < -0.15) return 'inverted';
  return 'normal';
}

/**
 * Recession probability based on 3m10y spread.
 * Uses a simplified Estrella-Mishkin probit mapping.
 * Spread < 0 → elevated probability, spread > 200bps → near-zero.
 */
export function recessionProbability(spreadBps3m10y: number): number {
  // Simple logistic approximation of the probit model
  const x = -spreadBps3m10y / 100; // invert: negative spread → positive x
  const p = 1 / (1 + Math.exp(-1.5 * x - 0.5));
  return Math.round(p * 10000) / 100; // 0-100 with 2 decimal places
}

/**
 * Full yield curve analysis: spreads, shape, recession signal.
 */
export function analyzeYieldCurve(
  curve: YieldCurvePoint[],
  opts?: { igYieldPct?: number; hyYieldPct?: number },
): YieldCurveAnalysis {
  const spreads = treasurySpreads(curve);

  if (opts?.igYieldPct != null) {
    const ig = creditSpread(opts.igYieldPct, curve, '10y', 'IG-10y');
    if (ig) spreads.push(ig);
  }
  if (opts?.hyYieldPct != null) {
    const hy = creditSpread(opts.hyYieldPct, curve, '10y', 'HY-10y');
    if (hy) spreads.push(hy);
  }

  const curveShape = classifyCurveShape(curve);

  const s3m10y = spreads.find(s => s.name === '3m10y');
  const recessionProb = s3m10y ? recessionProbability(s3m10y.spreadBps) : 0;

  // Find steepest segment
  const sorted = [...curve].sort((a, b) => tenorYears(a.tenor) - tenorYears(b.tenor));
  let steepestSegment: string | null = null;
  let maxSlope = 0;
  for (let i = 1; i < sorted.length; i++) {
    const dy = Math.abs(sorted[i]!.yieldPct - sorted[i - 1]!.yieldPct);
    const dx = tenorYears(sorted[i]!.tenor) - tenorYears(sorted[i - 1]!.tenor);
    const slope = dx > 0 ? dy / dx : 0;
    if (slope > maxSlope) {
      maxSlope = slope;
      steepestSegment = `${sorted[i - 1]!.tenor}→${sorted[i]!.tenor}`;
    }
  }

  return {
    spreads,
    curveShape,
    recessionProbability: recessionProb,
    steepestSegment,
  };
}
