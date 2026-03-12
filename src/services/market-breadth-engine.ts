/**
 * F-28: Market Breadth Internals Engine
 *
 * Computes advance-decline metrics, McClellan Oscillator approximation,
 * breadth thrust signals, and cumulative breadth line from sector/stock data.
 */

export interface BreadthSnapshot {
  timestamp: number;
  advancing: number;
  declining: number;
  unchanged: number;
}

export interface BreadthMetrics {
  /** Advance/Decline ratio (>1 = more advancers) */
  adRatio: number;
  /** % of issues advancing (breadth thrust indicator) */
  thrustPct: number;
  /** Net advances (advancing - declining) */
  netAdvances: number;
  /** McClellan Oscillator approximation: 19-day EMA minus 39-day EMA of net advances */
  mcclellanOscillator: number | null;
  /** Cumulative A/D line value */
  cumulativeADLine: number;
  /** Signal strength: how extreme is the breadth reading */
  signal: 'extreme-bullish' | 'bullish' | 'neutral' | 'bearish' | 'extreme-bearish';
}

const history: BreadthSnapshot[] = [];
const MAX_HISTORY = 60; // Keep ~2 months of daily breadth data

function ema(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let result = values.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = period; i < values.length; i++) {
    result = values[i]! * k + result * (1 - k);
  }
  return result;
}

export function recordBreadthSnapshot(snapshot: Omit<BreadthSnapshot, 'timestamp'>): void {
  history.push({ ...snapshot, timestamp: Date.now() });
  if (history.length > MAX_HISTORY) {
    history.splice(0, history.length - MAX_HISTORY);
  }
}

export function computeBreadthMetrics(): BreadthMetrics {
  const latest = history.length > 0 ? history[history.length - 1]! : null;
  const adv = latest?.advancing ?? 0;
  const dec = latest?.declining ?? 0;
  const unch = latest?.unchanged ?? 0;
  const total = adv + dec + unch;

  const adRatio = dec > 0 ? Math.round((adv / dec) * 100) / 100 : adv > 0 ? Infinity : 1;
  const thrustPct = total > 0 ? Math.round((adv / total) * 10000) / 100 : 50;
  const netAdvances = adv - dec;

  // Cumulative A/D line
  const cumAD = history.reduce((sum, s) => sum + (s.advancing - s.declining), 0);

  // McClellan Oscillator: 19-EMA of net advances − 39-EMA of net advances
  const netHistory = history.map(s => s.advancing - s.declining);
  const ema19 = ema(netHistory, 19);
  const ema39 = ema(netHistory, 39);
  const mcclellan = ema19 != null && ema39 != null
    ? Math.round((ema19 - ema39) * 100) / 100
    : null;

  // Signal classification
  let signal: BreadthMetrics['signal'] = 'neutral';
  if (thrustPct >= 80) signal = 'extreme-bullish';
  else if (thrustPct >= 62) signal = 'bullish';
  else if (thrustPct <= 20) signal = 'extreme-bearish';
  else if (thrustPct <= 38) signal = 'bearish';

  return {
    adRatio,
    thrustPct,
    netAdvances,
    mcclellanOscillator: mcclellan,
    cumulativeADLine: cumAD,
    signal,
  };
}

export function getBreadthHistory(): readonly BreadthSnapshot[] {
  return history;
}

/**
 * Detect a Breadth Thrust signal: >61.5% advancing within 10 sessions after sub-40%.
 * Classic Marty Zweig indicator.
 */
export function detectBreadthThrust(): { triggered: boolean; daysSinceLow: number | null } {
  if (history.length < 2) return { triggered: false, daysSinceLow: null };

  const thrusts = history.map(s => {
    const total = s.advancing + s.declining + s.unchanged;
    return total > 0 ? s.advancing / total * 100 : 50;
  });

  // Find most recent sub-40 reading
  let lowIdx: number | null = null;
  for (let i = thrusts.length - 1; i >= 0; i--) {
    if (thrusts[i]! < 40) {
      lowIdx = i;
      break;
    }
  }

  if (lowIdx == null) return { triggered: false, daysSinceLow: null };

  const daysSinceLow = thrusts.length - 1 - lowIdx;

  // Check if any subsequent reading (within 10 sessions) exceeded 61.5%
  const triggered = daysSinceLow <= 10 && thrusts.slice(lowIdx + 1).some(t => t > 61.5);

  return { triggered, daysSinceLow };
}
