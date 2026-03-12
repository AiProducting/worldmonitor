/**
 * F-30: Sector Rotation Detector
 *
 * Tracks relative performance of GICS sectors to identify rotation patterns
 * (risk-on vs risk-off, cyclical vs defensive), and classifies the current
 * market regime based on which sectors are leading.
 */

export interface SectorMomentum {
  sector: string;
  /** 1-week relative return vs benchmark */
  relReturn1w: number;
  /** 4-week relative return vs benchmark */
  relReturn4w: number;
  /** Quadrant in the RRG (Relative Rotation Graph) */
  quadrant: 'leading' | 'weakening' | 'lagging' | 'improving';
}

export interface RotationSignal {
  regime: 'risk-on' | 'risk-off' | 'transition' | 'mixed';
  leadingSectors: string[];
  laggingSectors: string[];
  rotationDirection: 'into-cyclicals' | 'into-defensives' | 'broad-rally' | 'broad-selloff' | 'selective';
  momentum: SectorMomentum[];
}

const CYCLICAL_SECTORS = new Set([
  'Technology', 'Consumer Discretionary', 'Financials',
  'Industrials', 'Materials', 'Energy',
]);

const DEFENSIVE_SECTORS = new Set([
  'Utilities', 'Consumer Staples', 'Health Care', 'Real Estate',
]);

/**
 * Classify a sector's RRG quadrant from 1w and 4w relative returns.
 * - Leading:   short-term positive, medium-term positive
 * - Weakening: short-term negative, medium-term positive
 * - Lagging:   short-term negative, medium-term negative
 * - Improving: short-term positive, medium-term negative
 */
function classifyQuadrant(rel1w: number, rel4w: number): SectorMomentum['quadrant'] {
  if (rel1w >= 0 && rel4w >= 0) return 'leading';
  if (rel1w < 0 && rel4w >= 0) return 'weakening';
  if (rel1w < 0 && rel4w < 0) return 'lagging';
  return 'improving';
}

/**
 * Compute sector rotation signal from a map of sector returns.
 * @param sectorReturns Map of sector name → { return1w, return4w } (absolute %)
 * @param benchmarkReturn1w Benchmark (e.g., S&P 500) 1-week return
 * @param benchmarkReturn4w Benchmark 4-week return
 */
export function analyzeSectorRotation(
  sectorReturns: Map<string, { return1w: number; return4w: number }>,
  benchmarkReturn1w: number,
  benchmarkReturn4w: number,
): RotationSignal {
  const momentum: SectorMomentum[] = [];

  for (const [sector, returns] of sectorReturns) {
    const rel1w = Math.round((returns.return1w - benchmarkReturn1w) * 100) / 100;
    const rel4w = Math.round((returns.return4w - benchmarkReturn4w) * 100) / 100;
    momentum.push({
      sector,
      relReturn1w: rel1w,
      relReturn4w: rel4w,
      quadrant: classifyQuadrant(rel1w, rel4w),
    });
  }

  // Sort by 4-week relative return to find leaders/laggers
  const sorted = [...momentum].sort((a, b) => b.relReturn4w - a.relReturn4w);
  const leadingSectors = sorted.filter(s => s.quadrant === 'leading').map(s => s.sector);
  const laggingSectors = sorted.filter(s => s.quadrant === 'lagging').map(s => s.sector);

  // Determine rotation direction
  const cyclicalLeaders = leadingSectors.filter(s => CYCLICAL_SECTORS.has(s));
  const defensiveLeaders = leadingSectors.filter(s => DEFENSIVE_SECTORS.has(s));
  const cyclicalLaggers = laggingSectors.filter(s => CYCLICAL_SECTORS.has(s));

  let rotationDirection: RotationSignal['rotationDirection'] = 'selective';
  if (leadingSectors.length >= 6) {
    rotationDirection = 'broad-rally';
  } else if (laggingSectors.length >= 6) {
    rotationDirection = 'broad-selloff';
  } else if (cyclicalLeaders.length >= 3 && cyclicalLaggers.length === 0) {
    rotationDirection = 'into-cyclicals';
  } else if (defensiveLeaders.length >= 2 && cyclicalLeaders.length <= 1) {
    rotationDirection = 'into-defensives';
  }

  // Regime: risk-on if cyclicals lead, risk-off if defensives lead
  let regime: RotationSignal['regime'] = 'mixed';
  if (cyclicalLeaders.length >= 3 && defensiveLeaders.length <= 1) {
    regime = 'risk-on';
  } else if (defensiveLeaders.length >= 2 && cyclicalLeaders.length <= 1) {
    regime = 'risk-off';
  } else if (leadingSectors.length <= 2 && laggingSectors.length <= 2) {
    regime = 'transition';
  }

  return {
    regime,
    leadingSectors,
    laggingSectors,
    rotationDirection,
    momentum,
  };
}

/**
 * Get the stage of the business cycle based on sector leadership.
 * Simplified from Sam Stovall's sector rotation model.
 */
export function inferBusinessCycleStage(
  rotation: RotationSignal,
): 'early-expansion' | 'mid-expansion' | 'late-expansion' | 'contraction' | 'uncertain' {
  const leaders = new Set(rotation.leadingSectors);

  if (leaders.has('Technology') && leaders.has('Consumer Discretionary') && leaders.has('Financials')) {
    return 'early-expansion';
  }
  if (leaders.has('Technology') && leaders.has('Industrials')) {
    return 'mid-expansion';
  }
  if (leaders.has('Energy') && leaders.has('Materials')) {
    return 'late-expansion';
  }
  if (leaders.has('Utilities') && leaders.has('Health Care') && leaders.has('Consumer Staples')) {
    return 'contraction';
  }
  return 'uncertain';
}
