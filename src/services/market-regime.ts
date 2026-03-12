/**
 * F-32 — Market Regime Classifier
 *
 * Synthesizes signals from sentiment-trend, market-breadth-engine,
 * volatility-model, and sector-rotation to produce a single unified
 * market regime label with confidence score.
 */

// ─── Types ──────────────────────────────────────────────────────

export type RegimeLabel =
  | 'risk-on'
  | 'risk-off'
  | 'euphoria'
  | 'panic'
  | 'recovery'
  | 'deterioration'
  | 'neutral';

export interface RegimeInput {
  /** Sentiment composite 0-100 (Fear & Greed style) */
  sentimentScore?: number | null;
  /** Market breadth A/D ratio (advances / declines) */
  breadthADRatio?: number | null;
  /** McClellan Oscillator value */
  mcclellanOscillator?: number | null;
  /** VIX spot level */
  vixLevel?: number | null;
  /** Vol term structure shape */
  volTermShape?: 'contango' | 'backwardation' | 'flat' | null;
  /** Sector rotation regime */
  rotationRegime?: 'risk-on' | 'risk-off' | 'transition' | 'mixed' | null;
  /** Yield curve shape */
  curveShape?: 'normal' | 'flat' | 'inverted' | 'humped' | null;
}

export interface RegimeClassification {
  regime: RegimeLabel;
  confidence: number;          // 0-100
  components: RegimeVote[];
  timestamp: number;
}

export interface RegimeVote {
  source: string;
  vote: RegimeLabel;
  weight: number;
}

// ─── Constants ──────────────────────────────────────────────────

const WEIGHTS = {
  sentiment: 0.20,
  breadth:   0.20,
  volatility: 0.25,
  rotation:  0.20,
  yieldCurve: 0.15,
} as const;

// ─── Component classifiers ──────────────────────────────────────

function classifySentiment(score: number): RegimeLabel {
  if (score >= 80) return 'euphoria';
  if (score >= 60) return 'risk-on';
  if (score >= 40) return 'neutral';
  if (score >= 20) return 'risk-off';
  return 'panic';
}

function classifyBreadth(
  adRatio: number | null | undefined,
  mcOsc: number | null | undefined,
): RegimeLabel {
  if (adRatio == null) return 'neutral';
  // Strong breadth + positive McClellan → risk-on/euphoria
  const mc = mcOsc ?? 0;
  if (adRatio > 2.0 && mc > 100) return 'euphoria';
  if (adRatio > 1.3 && mc > 0) return 'risk-on';
  if (adRatio > 0.8) return 'neutral';
  if (adRatio > 0.5) return 'risk-off';
  return 'panic';
}

function classifyVolatility(
  vix: number | null | undefined,
  termShape: RegimeInput['volTermShape'],
): RegimeLabel {
  if (vix == null) return 'neutral';
  if (vix >= 35) return 'panic';
  if (vix >= 25) {
    return termShape === 'backwardation' ? 'panic' : 'risk-off';
  }
  if (vix >= 18) return 'neutral';
  if (vix >= 12) return 'risk-on';
  return 'euphoria';
}

function classifyRotation(
  regime: RegimeInput['rotationRegime'],
): RegimeLabel {
  if (regime === 'risk-on') return 'risk-on';
  if (regime === 'risk-off') return 'risk-off';
  if (regime === 'transition') return 'deterioration';
  return 'neutral';
}

function classifyYieldCurve(shape: RegimeInput['curveShape']): RegimeLabel {
  if (shape === 'normal') return 'risk-on';
  if (shape === 'inverted') return 'risk-off';
  if (shape === 'humped') return 'deterioration';
  return 'neutral';
}

// ─── Core ───────────────────────────────────────────────────────

/**
 * Classify the overall market regime from multiple signal dimensions.
 * Votes are weighted and the label with the highest weighted share wins.
 */
export function classifyMarketRegime(input: RegimeInput): RegimeClassification {
  const votes: RegimeVote[] = [];

  if (input.sentimentScore != null) {
    votes.push({
      source: 'sentiment',
      vote: classifySentiment(input.sentimentScore),
      weight: WEIGHTS.sentiment,
    });
  }

  if (input.breadthADRatio != null || input.mcclellanOscillator != null) {
    votes.push({
      source: 'breadth',
      vote: classifyBreadth(input.breadthADRatio, input.mcclellanOscillator),
      weight: WEIGHTS.breadth,
    });
  }

  if (input.vixLevel != null) {
    votes.push({
      source: 'volatility',
      vote: classifyVolatility(input.vixLevel, input.volTermShape),
      weight: WEIGHTS.volatility,
    });
  }

  if (input.rotationRegime != null) {
    votes.push({
      source: 'rotation',
      vote: classifyRotation(input.rotationRegime),
      weight: WEIGHTS.rotation,
    });
  }

  if (input.curveShape != null) {
    votes.push({
      source: 'yieldCurve',
      vote: classifyYieldCurve(input.curveShape),
      weight: WEIGHTS.yieldCurve,
    });
  }

  if (votes.length === 0) {
    return {
      regime: 'neutral',
      confidence: 0,
      components: [],
      timestamp: Date.now(),
    };
  }

  // Aggregate weighted votes
  const totals = new Map<RegimeLabel, number>();
  let totalWeight = 0;
  for (const v of votes) {
    totals.set(v.vote, (totals.get(v.vote) ?? 0) + v.weight);
    totalWeight += v.weight;
  }

  // Pick the label with the highest aggregate weight
  let best: RegimeLabel = 'neutral';
  let bestWeight = 0;
  for (const [label, w] of totals) {
    if (w > bestWeight) {
      bestWeight = w;
      best = label;
    }
  }

  // Confidence: winner's share of total weight, scaled to 0-100
  const confidence = totalWeight > 0
    ? Math.round((bestWeight / totalWeight) * 100)
    : 0;

  return {
    regime: best,
    confidence,
    components: votes,
    timestamp: Date.now(),
  };
}

// ─── Regime history ─────────────────────────────────────────────

const MAX_REGIME_HISTORY = 48;
const regimeHistory: RegimeClassification[] = [];

export function recordRegime(classification: RegimeClassification): void {
  regimeHistory.push(classification);
  if (regimeHistory.length > MAX_REGIME_HISTORY) regimeHistory.shift();
}

export function getRegimeHistory(): readonly RegimeClassification[] {
  return regimeHistory;
}

export function detectRegimeTransition(): {
  current: RegimeLabel;
  previous: RegimeLabel | null;
  transitioned: boolean;
} {
  const n = regimeHistory.length;
  if (n === 0) return { current: 'neutral', previous: null, transitioned: false };
  const current = regimeHistory[n - 1]!.regime;
  const previous = n >= 2 ? regimeHistory[n - 2]!.regime : null;
  return { current, previous, transitioned: previous != null && current !== previous };
}

/** Reset history (for testing). */
export function _resetRegimeHistory(): void {
  regimeHistory.length = 0;
}
