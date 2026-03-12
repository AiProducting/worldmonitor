/**
 * F-29: Volatility Term Structure Model
 *
 * Analyzes VIX term structure (contango vs backwardation),
 * computes realized vs implied volatility spread, and
 * detects vol regime changes useful for hedging decisions.
 */

export interface VolTermPoint {
  /** Days to expiration (e.g., 9 for VIX, 30 for VIX1M, 90 for VIX3M) */
  dte: number;
  /** Implied volatility level */
  iv: number;
  label: string;
}

export interface VolTermStructure {
  points: VolTermPoint[];
  /** Contango = far-dated IV > near-dated (normal); Backwardation = near > far (fear) */
  shape: 'contango' | 'backwardation' | 'flat';
  /** Steepness: IV difference between longest and shortest tenor */
  steepness: number;
  /** Front-month roll yield proxy: (VIX1M - VIX) / VIX */
  rollYieldPct: number | null;
}

export interface VolRegime {
  current: 'low' | 'moderate' | 'elevated' | 'extreme';
  spotVix: number;
  realizedVol30d: number | null;
  /** Positive = IV premium; Negative = RV premium */
  ivRvSpread: number | null;
  /** Whether structure flipped from contango to backwardation recently */
  structureFlip: boolean;
}

export function classifyTermStructure(points: VolTermPoint[]): VolTermStructure {
  if (points.length < 2) {
    return { points, shape: 'flat', steepness: 0, rollYieldPct: null };
  }

  const sorted = [...points].sort((a, b) => a.dte - b.dte);
  const front = sorted[0]!;
  const back = sorted[sorted.length - 1]!;
  const steepness = Math.round((back.iv - front.iv) * 100) / 100;

  let shape: VolTermStructure['shape'] = 'flat';
  if (steepness > 0.5) shape = 'contango';
  else if (steepness < -0.5) shape = 'backwardation';

  // Roll yield proxy: uses first two tenors
  let rollYieldPct: number | null = null;
  if (sorted.length >= 2 && front.iv > 0) {
    rollYieldPct = Math.round(((sorted[1]!.iv - front.iv) / front.iv) * 10000) / 100;
  }

  return { points: sorted, shape, steepness, rollYieldPct };
}

export function classifyVolRegime(spotVix: number): VolRegime['current'] {
  if (spotVix <= 15) return 'low';
  if (spotVix <= 20) return 'moderate';
  if (spotVix <= 30) return 'elevated';
  return 'extreme';
}

/**
 * Compute 30-day realized (historical) volatility from daily returns.
 * Returns annualized vol in percentage points.
 */
export function realizedVol30d(dailyReturns: number[]): number | null {
  if (dailyReturns.length < 20) return null;
  const window = dailyReturns.slice(-30);
  const mean = window.reduce((s, r) => s + r, 0) / window.length;
  const variance = window.reduce((s, r) => s + (r - mean) ** 2, 0) / (window.length - 1);
  // Annualize: * sqrt(252)
  return Math.round(Math.sqrt(variance * 252) * 10000) / 100;
}

let prevShape: VolTermStructure['shape'] | null = null;

export function analyzeVolRegime(
  spotVix: number,
  termPoints: VolTermPoint[],
  dailyReturns?: number[],
): VolRegime {
  const current = classifyVolRegime(spotVix);
  const structure = classifyTermStructure(termPoints);

  const rv30 = dailyReturns ? realizedVol30d(dailyReturns) : null;
  const ivRvSpread = rv30 != null ? Math.round((spotVix - rv30) * 100) / 100 : null;

  const structureFlip = prevShape != null && prevShape !== structure.shape &&
    (structure.shape === 'backwardation' || prevShape === 'backwardation');

  prevShape = structure.shape;

  return {
    current,
    spotVix,
    realizedVol30d: rv30,
    ivRvSpread,
    structureFlip,
  };
}
