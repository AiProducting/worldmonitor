/**
 * F-33 — Portfolio Risk Decomposition
 *
 * Given a set of portfolio positions with weights and return series,
 * computes:
 *  - position-level contribution to total portfolio variance
 *  - parametric Value-at-Risk (VaR) at 95% and 99% confidence
 *  - sector concentration (Herfindahl-Hirschman index)
 *  - diversification ratio
 */

// ─── Types ──────────────────────────────────────────────────────

export interface Position {
  symbol: string;
  sector: string;
  weightPct: number;       // portfolio weight 0-100
  returns: number[];       // periodic log returns
}

export interface PositionRiskContribution {
  symbol: string;
  sector: string;
  weightPct: number;
  volatilityPct: number;     // annualised std-dev
  /** Contribution to portfolio variance (0-1), sums to 1 */
  varianceContribution: number;
  /** Marginal contribution to VaR (absolute) */
  marginalVaR: number;
}

export interface PortfolioRisk {
  /** Annualised portfolio volatility (%) */
  portfolioVolPct: number;
  /** Parametric VaR at 95% confidence (as +% loss) */
  var95Pct: number;
  /** Parametric VaR at 99% confidence (as +% loss) */
  var99Pct: number;
  /** Per-position risk attribution */
  contributions: PositionRiskContribution[];
  /** Sector Herfindahl-Hirschman Index 0-10000 */
  sectorHHI: number;
  /** Diversification ratio: sum(w_i * σ_i) / σ_portfolio */
  diversificationRatio: number;
}

// ─── Helpers ────────────────────────────────────────────────────

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function stddev(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  const variance = arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(variance);
}

function covariance(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  const ma = mean(a.slice(0, n));
  const mb = mean(b.slice(0, n));
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += (a[i]! - ma) * (b[i]! - mb);
  }
  return sum / (n - 1);
}

const ANNUALISE = Math.sqrt(252);
const Z_95 = 1.6449;
const Z_99 = 2.3263;

// ─── Core ───────────────────────────────────────────────────────

/**
 * Build NxN covariance matrix from position return series.
 */
export function buildCovarianceMatrix(positions: Position[]): number[][] {
  const n = positions.length;
  const mat: number[][] = Array.from({ length: n }, () => new Array(n).fill(0) as number[]);
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      const c = covariance(positions[i]!.returns, positions[j]!.returns);
      mat[i]![j] = c;
      mat[j]![i] = c;
    }
  }
  return mat;
}

/**
 * Full portfolio risk decomposition.
 */
export function decomposePortfolioRisk(positions: Position[]): PortfolioRisk {
  if (positions.length === 0) {
    return {
      portfolioVolPct: 0,
      var95Pct: 0,
      var99Pct: 0,
      contributions: [],
      sectorHHI: 0,
      diversificationRatio: 1,
    };
  }

  const n = positions.length;
  const weights = positions.map(p => p.weightPct / 100); // normalise to decimals
  const covMat = buildCovarianceMatrix(positions);

  // Portfolio variance: w' Σ w
  let portfolioVariance = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      portfolioVariance += weights[i]! * weights[j]! * covMat[i]![j]!;
    }
  }
  // Clamp to avoid sqrt of negative due to floating point
  portfolioVariance = Math.max(portfolioVariance, 0);
  const portfolioStd = Math.sqrt(portfolioVariance);
  const portfolioVolPct = Math.round(portfolioStd * ANNUALISE * 10000) / 100;

  // Per-position risk contribution: w_i * (Σ w)_i / σ_p²
  const sigmaW: number[] = new Array(n).fill(0) as number[];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      sigmaW[i]! += covMat[i]![j]! * weights[j]!;
    }
  }

  const contributions: PositionRiskContribution[] = positions.map((pos, i) => {
    const posVol = stddev(pos.returns);
    const annVol = Math.round(posVol * ANNUALISE * 10000) / 100;
    const varContrib = portfolioVariance > 0
      ? (weights[i]! * sigmaW[i]!) / portfolioVariance
      : 0;
    // Marginal VaR = Z * (∂σ/∂w_i) ≈ Z * (Σw)_i / σ_p
    const marginalVaR = portfolioStd > 0
      ? Math.round(Z_95 * (sigmaW[i]! / portfolioStd) * ANNUALISE * 10000) / 100
      : 0;

    return {
      symbol: pos.symbol,
      sector: pos.sector,
      weightPct: pos.weightPct,
      volatilityPct: annVol,
      varianceContribution: Math.round(varContrib * 10000) / 10000,
      marginalVaR,
    };
  });

  // Parametric VaR (annual)
  const var95Pct = Math.round(Z_95 * portfolioStd * ANNUALISE * 10000) / 100;
  const var99Pct = Math.round(Z_99 * portfolioStd * ANNUALISE * 10000) / 100;

  // Sector concentration: HHI of sector weights
  const sectorWeights = new Map<string, number>();
  for (const p of positions) {
    sectorWeights.set(p.sector, (sectorWeights.get(p.sector) ?? 0) + p.weightPct);
  }
  const sectorHHI = Math.round(
    [...sectorWeights.values()].reduce((s, w) => s + w * w, 0),
  );

  // Diversification ratio: Σ(w_i * σ_i) / σ_portfolio
  const weightedVolSum = positions.reduce(
    (s, p, i) => s + weights[i]! * stddev(p.returns),
    0,
  );
  const diversificationRatio = portfolioStd > 0
    ? Math.round((weightedVolSum / portfolioStd) * 100) / 100
    : 1;

  return {
    portfolioVolPct,
    var95Pct,
    var99Pct,
    contributions,
    sectorHHI,
    diversificationRatio,
  };
}

/**
 * Quick check: is the portfolio over-concentrated in a single sector?
 * HHI > 2500 → moderately concentrated, > 5000 → highly concentrated.
 */
export function concentrationWarning(
  hhi: number,
): 'highly-concentrated' | 'moderately-concentrated' | 'diversified' {
  if (hhi > 5000) return 'highly-concentrated';
  if (hhi > 2500) return 'moderately-concentrated';
  return 'diversified';
}
