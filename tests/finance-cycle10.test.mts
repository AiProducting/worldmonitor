import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  recordBreadthSnapshot,
  computeBreadthMetrics,
  getBreadthHistory,
  detectBreadthThrust,
} from '../src/services/market-breadth-engine.ts';

import {
  classifyTermStructure,
  classifyVolRegime,
  realizedVol30d,
  analyzeVolRegime,
} from '../src/services/volatility-model.ts';

import {
  analyzeSectorRotation,
  inferBusinessCycleStage,
} from '../src/services/sector-rotation.ts';

// ── Market Breadth Engine (F-28) ────────────────────────────────────

describe('market breadth engine (F-28)', () => {
  it('records breadth snapshots and computes metrics', () => {
    recordBreadthSnapshot({ advancing: 300, declining: 150, unchanged: 50 });
    const m = computeBreadthMetrics();
    assert.ok(m.adRatio > 1, 'A/D ratio should be > 1 when advancers dominate');
    assert.ok(m.thrustPct > 50, 'Thrust pct should be > 50%');
    assert.equal(m.netAdvances, 300 - 150);
  });

  it('classifies breadth signal from thrust percentage', () => {
    recordBreadthSnapshot({ advancing: 400, declining: 50, unchanged: 50 });
    const m = computeBreadthMetrics();
    assert.equal(m.signal, 'extreme-bullish');
  });

  it('classifies bearish signal when decliners dominate', () => {
    recordBreadthSnapshot({ advancing: 50, declining: 400, unchanged: 50 });
    const m = computeBreadthMetrics();
    assert.ok(m.signal === 'extreme-bearish' || m.signal === 'bearish');
  });

  it('computes cumulative A/D line from history', () => {
    const m = computeBreadthMetrics();
    const history = getBreadthHistory();
    assert.ok(history.length > 0);
    assert.equal(typeof m.cumulativeADLine, 'number');
  });

  it('detectBreadthThrust returns expected shape', () => {
    const result = detectBreadthThrust();
    assert.equal(typeof result.triggered, 'boolean');
  });
});

// ── Volatility Term Structure (F-29) ────────────────────────────────

describe('volatility term structure model (F-29)', () => {
  it('classifies contango when far-dated > near-dated', () => {
    const ts = classifyTermStructure([
      { dte: 9, iv: 15, label: 'VIX' },
      { dte: 30, iv: 18, label: 'VIX1M' },
      { dte: 90, iv: 20, label: 'VIX3M' },
    ]);
    assert.equal(ts.shape, 'contango');
    assert.ok(ts.steepness > 0);
  });

  it('classifies backwardation when near > far', () => {
    const ts = classifyTermStructure([
      { dte: 9, iv: 30, label: 'VIX' },
      { dte: 30, iv: 25, label: 'VIX1M' },
      { dte: 90, iv: 22, label: 'VIX3M' },
    ]);
    assert.equal(ts.shape, 'backwardation');
    assert.ok(ts.steepness < 0);
  });

  it('classifies vol regime based on VIX level', () => {
    assert.equal(classifyVolRegime(12), 'low');
    assert.equal(classifyVolRegime(18), 'moderate');
    assert.equal(classifyVolRegime(25), 'elevated');
    assert.equal(classifyVolRegime(40), 'extreme');
  });

  it('realizedVol30d returns null for insufficient data', () => {
    assert.equal(realizedVol30d([0.01, 0.02]), null);
  });

  it('realizedVol30d computes annualized volatility from returns', () => {
    const returns = Array.from({ length: 30 }, () => (Math.random() - 0.5) * 0.02);
    const rv = realizedVol30d(returns);
    assert.ok(rv != null && rv > 0);
  });

  it('analyzeVolRegime detects term structure flips', () => {
    // First call: contango
    analyzeVolRegime(15, [
      { dte: 9, iv: 15, label: 'VIX' },
      { dte: 90, iv: 20, label: 'VIX3M' },
    ]);
    // Second call: backwardation → should detect flip
    const regime = analyzeVolRegime(30, [
      { dte: 9, iv: 30, label: 'VIX' },
      { dte: 90, iv: 22, label: 'VIX3M' },
    ]);
    assert.equal(regime.structureFlip, true);
    assert.equal(regime.current, 'elevated');
  });
});

// ── Sector Rotation Detector (F-30) ─────────────────────────────────

describe('sector rotation detector (F-30)', () => {
  it('identifies risk-on regime when cyclicals lead', () => {
    const sectors = new Map([
      ['Technology', { return1w: 3.0, return4w: 8.0 }],
      ['Consumer Discretionary', { return1w: 2.5, return4w: 6.0 }],
      ['Financials', { return1w: 2.0, return4w: 5.0 }],
      ['Industrials', { return1w: 1.5, return4w: 4.0 }],
      ['Utilities', { return1w: -0.5, return4w: -2.0 }],
      ['Consumer Staples', { return1w: -0.3, return4w: -1.5 }],
      ['Health Care', { return1w: 0.5, return4w: 1.0 }],
    ]);
    const signal = analyzeSectorRotation(sectors, 1.0, 3.0);
    assert.equal(signal.regime, 'risk-on');
    assert.ok(signal.leadingSectors.includes('Technology'));
  });

  it('identifies risk-off regime when defensives lead', () => {
    const sectors = new Map([
      ['Utilities', { return1w: 2.0, return4w: 5.0 }],
      ['Consumer Staples', { return1w: 1.5, return4w: 4.0 }],
      ['Health Care', { return1w: 1.0, return4w: 3.0 }],
      ['Technology', { return1w: -2.0, return4w: -4.0 }],
      ['Financials', { return1w: -1.5, return4w: -3.0 }],
      ['Industrials', { return1w: -1.0, return4w: -2.0 }],
    ]);
    const signal = analyzeSectorRotation(sectors, 0, 0.5);
    assert.equal(signal.regime, 'risk-off');
    assert.ok(signal.laggingSectors.includes('Technology'));
  });

  it('classifies RRG quadrants correctly', () => {
    const sectors = new Map([
      ['Technology', { return1w: 2.0, return4w: 4.0 }],  // Leading
      ['Energy', { return1w: -1.0, return4w: 2.0 }],     // Weakening
      ['Utilities', { return1w: -1.0, return4w: -2.0 }],  // Lagging
      ['Materials', { return1w: 1.0, return4w: -1.0 }],   // Improving
    ]);
    const signal = analyzeSectorRotation(sectors, 0, 0);
    const byName = Object.fromEntries(signal.momentum.map(m => [m.sector, m.quadrant]));
    assert.equal(byName['Technology'], 'leading');
    assert.equal(byName['Energy'], 'weakening');
    assert.equal(byName['Utilities'], 'lagging');
    assert.equal(byName['Materials'], 'improving');
  });

  it('infers early expansion from sector leadership', () => {
    const signal = {
      regime: 'risk-on' as const,
      leadingSectors: ['Technology', 'Consumer Discretionary', 'Financials'],
      laggingSectors: ['Utilities'],
      rotationDirection: 'into-cyclicals' as const,
      momentum: [],
    };
    assert.equal(inferBusinessCycleStage(signal), 'early-expansion');
  });

  it('infers contraction from defensive leadership', () => {
    const signal = {
      regime: 'risk-off' as const,
      leadingSectors: ['Utilities', 'Health Care', 'Consumer Staples'],
      laggingSectors: ['Technology', 'Financials'],
      rotationDirection: 'into-defensives' as const,
      momentum: [],
    };
    assert.equal(inferBusinessCycleStage(signal), 'contraction');
  });
});
