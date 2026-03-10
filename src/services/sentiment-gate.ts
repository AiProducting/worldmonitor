import { mlWorker } from './ml-worker';
import type { NewsItem } from '@/types';

const DEFAULT_THRESHOLD = 0.85;
const BATCH_SIZE = 20; // ML_THRESHOLDS.maxTextsPerBatch from ml-config.ts

export interface SentimentGateStats {
  totalProcessed: number;
  passed: number;
  filtered: number;
  mlUnavailablePassThroughs: number;
  lastThreshold: number;
}

const stats: SentimentGateStats = {
  totalProcessed: 0,
  passed: 0,
  filtered: 0,
  mlUnavailablePassThroughs: 0,
  lastThreshold: DEFAULT_THRESHOLD,
};

/** Returns a snapshot of cumulative sentiment gate statistics. */
export function getSentimentGateStats(): Readonly<SentimentGateStats> {
  return { ...stats };
}

/** Resets all gate statistics (useful in tests or on session restart). */
export function resetSentimentGateStats(): void {
  stats.totalProcessed = 0;
  stats.passed = 0;
  stats.filtered = 0;
  stats.mlUnavailablePassThroughs = 0;
  stats.lastThreshold = DEFAULT_THRESHOLD;
}

/**
 * Returns the fraction of processed items that were rejected by the sentiment
 * gate (0–1). Returns 0 when no items have been processed yet.
 */
export function getSentimentRejectionRate(): number {
  if (stats.totalProcessed === 0) return 0;
  return stats.filtered / stats.totalProcessed;
}

/**
 * Filter news items by positive sentiment using DistilBERT-SST2.
 * Returns only items classified as positive with score >= threshold.
 *
 * Graceful degradation:
 * - If mlWorker is not ready/available, returns all items unfiltered
 * - If classification fails, returns all items unfiltered
 * - Batches titles to respect ML worker limits
 *
 * @param items - News items to filter
 * @param threshold - Minimum positive confidence score (default 0.85)
 * @returns Items passing the sentiment filter
 */
export async function filterBySentiment(
  items: NewsItem[],
  threshold = DEFAULT_THRESHOLD
): Promise<NewsItem[]> {
  if (items.length === 0) return [];

  // Check localStorage override for threshold tuning during development
  try {
    const override = localStorage.getItem('positive-threshold');
    if (override) {
      const parsed = parseFloat(override);
      if (!isNaN(parsed) && parsed >= 0 && parsed <= 1) {
        threshold = parsed;
      }
    }
  } catch { /* ignore localStorage errors */ }

  stats.lastThreshold = threshold;

  // Graceful degradation: if ML not available, pass all items through
  if (!mlWorker.isAvailable) {
    stats.totalProcessed += items.length;
    stats.passed += items.length;
    stats.mlUnavailablePassThroughs += items.length;
    return items;
  }

  try {
    const titles = items.map(item => item.title);
    const allResults: Array<{ label: string; score: number }> = [];

    // Batch to avoid overwhelming the worker
    for (let i = 0; i < titles.length; i += BATCH_SIZE) {
      const batch = titles.slice(i, i + BATCH_SIZE);
      const batchResults = await mlWorker.classifySentiment(batch);
      allResults.push(...batchResults);
    }

    const passed = items.filter((_, idx) => {
      const result = allResults[idx];
      return result && result.label === 'positive' && result.score >= threshold;
    });

    stats.totalProcessed += items.length;
    stats.passed += passed.length;
    stats.filtered += items.length - passed.length;

    return passed;
  } catch (err) {
    console.warn('[SentimentGate] Sentiment classification failed, passing all items through:', err);
    stats.totalProcessed += items.length;
    stats.passed += items.length;
    stats.mlUnavailablePassThroughs += items.length;
    return items;
  }
}
