/**
 * F-27: Cross-Asset Correlation Engine
 *
 * Provides reusable Pearson correlation, rolling windows,
 * and correlation regime detection for any pair of return series.
 */

export interface CorrelationResult {
  assetA: string;
  assetB: string;
  correlation: number;
  /** Number of overlapping observations used */
  observations: number;
}

export interface CorrelationMatrix {
  assets: string[];
  /** Row-major NxN correlation matrix */
  matrix: number[][];
}

export interface RollingCorrelation {
  assetA: string;
  assetB: string;
  window: number;
  /** Oldest to newest */
  values: Array<{ endIndex: number; correlation: number }>;
}

export interface CorrelationRegime {
  assetA: string;
  assetB: string;
  currentCorrelation: number;
  regime: 'strong-positive' | 'weak-positive' | 'uncorrelated' | 'weak-negative' | 'strong-negative';
  /** Whether correlation shifted regime vs prior window */
  regimeShift: boolean;
  priorCorrelation: number | null;
}

/**
 * Pearson correlation coefficient for two aligned return series.
 * Returns 0 if insufficient data (< 5 observations).
 */
export function pearsonCorrelation(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 5) return 0;
  let sumA = 0, sumB = 0;
  for (let i = 0; i < n; i++) { sumA += a[i]!; sumB += b[i]!; }
  const meanA = sumA / n;
  const meanB = sumB / n;
  let num = 0, denA = 0, denB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i]! - meanA;
    const db = b[i]! - meanB;
    num += da * db;
    denA += da * da;
    denB += db * db;
  }
  const den = Math.sqrt(denA * denB);
  return den === 0 ? 0 : Math.round((num / den) * 10000) / 10000;
}

/**
 * Convert price series to log returns: ln(P_t / P_{t-1}).
 */
export function toLogReturns(prices: number[]): number[] {
  const r: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    const prev = prices[i - 1]!;
    const curr = prices[i]!;
    if (prev > 0 && curr > 0) {
      r.push(Math.log(curr / prev));
    } else {
      r.push(0);
    }
  }
  return r;
}

/**
 * Build a full NxN correlation matrix from a map of asset -> returns.
 */
export function buildCorrelationMatrix(
  returnsByAsset: Map<string, number[]>,
): CorrelationMatrix {
  const assets = [...returnsByAsset.keys()];
  const n = assets.length;
  const matrix: number[][] = Array.from({ length: n }, () => Array(n).fill(0) as number[]);

  for (let i = 0; i < n; i++) {
    matrix[i]![i] = 1;
    for (let j = i + 1; j < n; j++) {
      const a = returnsByAsset.get(assets[i]!)!;
      const b = returnsByAsset.get(assets[j]!)!;
      const r = pearsonCorrelation(a, b);
      matrix[i]![j] = r;
      matrix[j]![i] = r;
    }
  }

  return { assets, matrix };
}

/**
 * Compute rolling correlations over a sliding window.
 */
export function rollingCorrelation(
  a: number[],
  b: number[],
  window: number,
  assetA = 'A',
  assetB = 'B',
): RollingCorrelation {
  const n = Math.min(a.length, b.length);
  const values: RollingCorrelation['values'] = [];

  for (let end = window; end <= n; end++) {
    const sliceA = a.slice(end - window, end);
    const sliceB = b.slice(end - window, end);
    values.push({
      endIndex: end - 1,
      correlation: pearsonCorrelation(sliceA, sliceB),
    });
  }

  return { assetA, assetB, window, values };
}

function regimeLabel(r: number): CorrelationRegime['regime'] {
  if (r >= 0.7) return 'strong-positive';
  if (r >= 0.3) return 'weak-positive';
  if (r <= -0.7) return 'strong-negative';
  if (r <= -0.3) return 'weak-negative';
  return 'uncorrelated';
}

/**
 * Detect regime shifts by comparing current window vs prior window correlations.
 */
export function detectCorrelationRegime(
  rolling: RollingCorrelation,
): CorrelationRegime {
  const vals = rolling.values;
  const current = vals.length > 0 ? vals[vals.length - 1]!.correlation : 0;
  const prior = vals.length > 1 ? vals[vals.length - 2]!.correlation : null;
  const currentRegime = regimeLabel(current);
  const priorRegime = prior != null ? regimeLabel(prior) : null;

  return {
    assetA: rolling.assetA,
    assetB: rolling.assetB,
    currentCorrelation: current,
    regime: currentRegime,
    regimeShift: priorRegime != null && currentRegime !== priorRegime,
    priorCorrelation: prior,
  };
}
