/**
 * F-25: Market Sentiment Trend Tracker
 *
 * Tracks rolling Fear & Greed composite scores over time,
 * computes trend direction, momentum, and signals regime changes.
 */

export interface SentimentReading {
  timestamp: number;
  composite: number;
  label: 'extreme-fear' | 'fear' | 'neutral' | 'greed' | 'extreme-greed';
}

export interface SentimentTrend {
  direction: 'improving' | 'deteriorating' | 'stable';
  momentum: number;        // rate of change per hour
  readings: SentimentReading[];
  regimeShift: boolean;    // true when label changed in last 2 readings
  currentStreak: number;   // consecutive readings in same direction
  sma5: number | null;     // 5-period simple moving average
  sma20: number | null;    // 20-period SMA (if enough data)
}

const MAX_HISTORY = 96; // ~24h at 15-min intervals
const STABLE_THRESHOLD = 0.5; // momentum below this = stable

const history: SentimentReading[] = [];

function labelFromScore(score: number): SentimentReading['label'] {
  if (score <= 20) return 'extreme-fear';
  if (score <= 40) return 'fear';
  if (score <= 60) return 'neutral';
  if (score <= 80) return 'greed';
  return 'extreme-greed';
}

function sma(readings: SentimentReading[], n: number): number | null {
  if (readings.length < n) return null;
  const slice = readings.slice(-n);
  return slice.reduce((s, r) => s + r.composite, 0) / n;
}

function computeMomentum(readings: SentimentReading[]): number {
  if (readings.length < 2) return 0;
  const recent = readings[readings.length - 1]!;
  const prev = readings[readings.length - 2]!;
  const dtHours = (recent.timestamp - prev.timestamp) / 3_600_000;
  if (dtHours <= 0) return 0;
  return (recent.composite - prev.composite) / dtHours;
}

function computeStreak(readings: SentimentReading[]): number {
  if (readings.length < 2) return 0;
  let streak = 0;
  for (let i = readings.length - 1; i >= 1; i--) {
    const diff = readings[i]!.composite - readings[i - 1]!.composite;
    const prevDiff = i < readings.length - 1
      ? readings[i + 1]!.composite - readings[i]!.composite
      : diff;
    if (Math.sign(diff) === Math.sign(prevDiff) && diff !== 0) {
      streak++;
    } else {
      break;
    }
  }
  return streak;
}

export function recordSentimentScore(composite: number): void {
  const reading: SentimentReading = {
    timestamp: Date.now(),
    composite,
    label: labelFromScore(composite),
  };
  history.push(reading);
  if (history.length > MAX_HISTORY) {
    history.splice(0, history.length - MAX_HISTORY);
  }
}

export function getSentimentTrend(): SentimentTrend {
  const momentum = computeMomentum(history);
  const direction: SentimentTrend['direction'] =
    Math.abs(momentum) < STABLE_THRESHOLD ? 'stable'
      : momentum > 0 ? 'improving'
      : 'deteriorating';

  const regimeShift = history.length >= 2 &&
    history[history.length - 1]!.label !== history[history.length - 2]!.label;

  return {
    direction,
    momentum: Math.round(momentum * 100) / 100,
    readings: [...history],
    regimeShift,
    currentStreak: computeStreak(history),
    sma5: sma(history, 5),
    sma20: sma(history, 20),
  };
}

export function getSentimentHistory(): readonly SentimentReading[] {
  return history;
}

export function getSentimentSummary(): {
  current: number | null;
  label: SentimentReading['label'] | null;
  trend: SentimentTrend['direction'];
  regimeShift: boolean;
  hourlyMomentum: number;
} {
  const latest = history.length > 0 ? history[history.length - 1]! : null;
  const trend = getSentimentTrend();
  return {
    current: latest?.composite ?? null,
    label: latest?.label ?? null,
    trend: trend.direction,
    regimeShift: trend.regimeShift,
    hourlyMomentum: trend.momentum,
  };
}
