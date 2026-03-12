import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  recordSentimentScore,
  getSentimentTrend,
  getSentimentHistory,
  getSentimentSummary,
} from '../src/services/sentiment-trend.ts';

import {
  pearsonCorrelation,
  toLogReturns,
  buildCorrelationMatrix,
  rollingCorrelation,
  detectCorrelationRegime,
} from '../src/services/correlation-engine.ts';

// ── Sentiment Trend (F-25) ──────────────────────────────────────────

describe('sentiment trend tracker (F-25)', () => {
  it('records and retrieves sentiment readings', () => {
    recordSentimentScore(45);
    recordSentimentScore(50);
    const history = getSentimentHistory();
    assert.ok(history.length >= 2, 'Should have at least 2 readings');
    assert.equal(history[history.length - 1]?.label, 'neutral');
  });

  it('computes trend direction from momentum', () => {
    // Record ascending scores
    recordSentimentScore(30);
    recordSentimentScore(40);
    recordSentimentScore(55);
    const trend = getSentimentTrend();
    assert.ok(['improving', 'stable', 'deteriorating'].includes(trend.direction));
    assert.equal(typeof trend.momentum, 'number');
    assert.equal(typeof trend.regimeShift, 'boolean');
    assert.equal(typeof trend.currentStreak, 'number');
  });

  it('detects regime shift when label changes', () => {
    recordSentimentScore(19); // extreme-fear
    recordSentimentScore(25); // fear  → regime shift from extreme-fear
    const trend = getSentimentTrend();
    assert.equal(trend.regimeShift, true);
  });

  it('getSentimentSummary returns expected shape', () => {
    const summary = getSentimentSummary();
    assert.ok(summary.current != null);
    assert.ok(summary.label != null);
    assert.ok(['improving', 'stable', 'deteriorating'].includes(summary.trend));
    assert.equal(typeof summary.hourlyMomentum, 'number');
  });
});

// ── Correlation Engine (F-27) ───────────────────────────────────────

describe('cross-asset correlation engine (F-27)', () => {
  it('pearsonCorrelation returns 1 for identical series', () => {
    const a = [1, 2, 3, 4, 5, 6, 7];
    assert.ok(Math.abs(pearsonCorrelation(a, a) - 1) < 0.001);
  });

  it('pearsonCorrelation returns -1 for perfectly inverse series', () => {
    const a = [1, 2, 3, 4, 5, 6, 7];
    const b = [7, 6, 5, 4, 3, 2, 1];
    assert.ok(Math.abs(pearsonCorrelation(a, b) - (-1)) < 0.001);
  });

  it('pearsonCorrelation returns 0 for insufficient data', () => {
    assert.equal(pearsonCorrelation([1, 2], [3, 4]), 0);
  });

  it('toLogReturns computes log returns from prices', () => {
    const prices = [100, 105, 110];
    const returns = toLogReturns(prices);
    assert.equal(returns.length, 2);
    assert.ok(Math.abs(returns[0]! - Math.log(105 / 100)) < 0.0001);
    assert.ok(Math.abs(returns[1]! - Math.log(110 / 105)) < 0.0001);
  });

  it('buildCorrelationMatrix produces NxN matrix with 1s on diagonal', () => {
    const data = new Map<string, number[]>();
    data.set('A', [1, 2, 3, 4, 5, 6]);
    data.set('B', [2, 4, 6, 8, 10, 12]);
    data.set('C', [6, 5, 4, 3, 2, 1]);
    const { assets, matrix } = buildCorrelationMatrix(data);
    assert.equal(assets.length, 3);
    assert.equal(matrix.length, 3);
    // Diagonal should be 1
    for (let i = 0; i < 3; i++) {
      assert.equal(matrix[i]![i], 1);
    }
    // A and B perfectly correlated
    assert.ok(Math.abs(matrix[0]![1]! - 1) < 0.01);
    // A and C inversely correlated
    assert.ok(matrix[0]![2]! < -0.9);
  });

  it('rollingCorrelation produces windowed values', () => {
    const a = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const b = [2, 4, 6, 8, 10, 12, 14, 16, 18, 20];
    const result = rollingCorrelation(a, b, 5, 'SPX', 'NDX');
    assert.equal(result.assetA, 'SPX');
    assert.equal(result.window, 5);
    assert.ok(result.values.length > 0);
    // All correlations should be ~1 for perfectly correlated series
    for (const v of result.values) {
      assert.ok(Math.abs(v.correlation - 1) < 0.01);
    }
  });

  it('detectCorrelationRegime identifies regime and shifts', () => {
    const rolling = {
      assetA: 'SPX',
      assetB: 'Gold',
      window: 20,
      values: [
        { endIndex: 19, correlation: 0.8 },
        { endIndex: 20, correlation: 0.2 },
      ],
    };
    const regime = detectCorrelationRegime(rolling);
    assert.equal(regime.regime, 'uncorrelated');
    assert.equal(regime.regimeShift, true);
    assert.ok(regime.priorCorrelation != null);
  });
});
