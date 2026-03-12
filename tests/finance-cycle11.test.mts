import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

/* ── F-31  Yield Spread Analyzer ─────────────────────────────── */
import {
  computeSpread,
  treasurySpreads,
  creditSpread,
  classifyCurveShape,
  recessionProbability,
  analyzeYieldCurve,
} from '../src/services/yield-spread.js';

/* ── F-32  Market Regime Classifier ──────────────────────────── */
import {
  classifyMarketRegime,
  recordRegime,
  getRegimeHistory,
  detectRegimeTransition,
  _resetRegimeHistory,
} from '../src/services/market-regime.js';

/* ── F-33  Portfolio Risk Decomposition ──────────────────────── */
import {
  decomposePortfolioRisk,
  buildCovarianceMatrix,
  concentrationWarning,
} from '../src/services/portfolio-risk.js';

// ─── Fixtures ───────────────────────────────────────────────────

const normalCurve = [
  { tenor: '3m', yieldPct: 4.50 },
  { tenor: '2y', yieldPct: 4.20 },
  { tenor: '5y', yieldPct: 4.00 },
  { tenor: '10y', yieldPct: 3.80 },
  { tenor: '30y', yieldPct: 4.10 },
];

const invertedCurve = [
  { tenor: '3m', yieldPct: 5.30 },
  { tenor: '2y', yieldPct: 5.00 },
  { tenor: '5y', yieldPct: 4.50 },
  { tenor: '10y', yieldPct: 4.20 },
  { tenor: '30y', yieldPct: 4.10 },
];

const humpedCurve = [
  { tenor: '3m', yieldPct: 3.00 },
  { tenor: '2y', yieldPct: 4.50 },
  { tenor: '5y', yieldPct: 4.80 },
  { tenor: '10y', yieldPct: 3.90 },
  { tenor: '30y', yieldPct: 3.50 },
];

// ─── F-31 Tests ─────────────────────────────────────────────────

describe('F-31 Yield Spread Analyzer', () => {
  it('computes a named spread between two tenors', () => {
    const s = computeSpread(normalCurve, '2y', '10y', '2s10s');
    assert.ok(s);
    assert.equal(s.name, '2s10s');
    assert.equal(s.spreadBps, -40); // 3.80 - 4.20 = -0.40 → -40bps
    assert.equal(s.inverted, true);
  });

  it('returns null when tenor not found', () => {
    const s = computeSpread(normalCurve, '1y', '10y');
    assert.equal(s, null);
  });

  it('treasurySpreads returns 2s10s and 3m10y', () => {
    const spreads = treasurySpreads(invertedCurve);
    assert.equal(spreads.length, 2);
    const names = spreads.map(s => s.name);
    assert.ok(names.includes('2s10s'));
    assert.ok(names.includes('3m10y'));
    const s3m10 = spreads.find(s => s.name === '3m10y')!;
    assert.equal(s3m10.spreadBps, -110); // 4.20 - 5.30
    assert.equal(s3m10.inverted, true);
  });

  it('creditSpread computes IG spread over treasury', () => {
    const cs = creditSpread(5.5, normalCurve, '10y', 'IG-10y');
    assert.ok(cs);
    assert.equal(cs.spreadBps, 170); // 5.5 - 3.80 = 1.70 → 170bps
    assert.equal(cs.inverted, false);
  });

  it('classifyCurveShape returns normal for upward sloping', () => {
    // Use a clearly normal curve
    const curve = [
      { tenor: '3m', yieldPct: 2.0 },
      { tenor: '2y', yieldPct: 2.5 },
      { tenor: '10y', yieldPct: 3.5 },
      { tenor: '30y', yieldPct: 4.0 },
    ];
    assert.equal(classifyCurveShape(curve), 'normal');
  });

  it('classifyCurveShape detects inverted', () => {
    assert.equal(classifyCurveShape(invertedCurve), 'inverted');
  });

  it('classifyCurveShape detects humped', () => {
    assert.equal(classifyCurveShape(humpedCurve), 'humped');
  });

  it('recessionProbability rises for negative spreads', () => {
    const pNeg = recessionProbability(-150); // deeply inverted
    const pPos = recessionProbability(200);  // normal
    assert.ok(pNeg > pPos, `${pNeg} should be > ${pPos}`);
    assert.ok(pNeg > 50, 'deeply inverted should give >50% probability');
    assert.ok(pPos < 30, 'normal spread should give <30% probability');
  });

  it('analyzeYieldCurve returns full analysis', () => {
    const a = analyzeYieldCurve(invertedCurve, { igYieldPct: 5.8 });
    assert.equal(a.curveShape, 'inverted');
    assert.ok(a.spreads.length >= 3); // 2s10s, 3m10y, IG-10y
    assert.ok(a.recessionProbability > 40);
    assert.ok(a.steepestSegment);
  });
});

// ─── F-32 Tests ─────────────────────────────────────────────────

describe('F-32 Market Regime Classifier', () => {
  before(() => _resetRegimeHistory());

  it('returns neutral with empty input', () => {
    const r = classifyMarketRegime({});
    assert.equal(r.regime, 'neutral');
    assert.equal(r.confidence, 0);
    assert.equal(r.components.length, 0);
  });

  it('classifies euphoria from strong risk-on inputs', () => {
    const r = classifyMarketRegime({
      sentimentScore: 90,
      breadthADRatio: 3.0,
      mcclellanOscillator: 150,
      vixLevel: 10,
      rotationRegime: 'risk-on',
      curveShape: 'normal',
    });
    assert.ok(
      r.regime === 'euphoria' || r.regime === 'risk-on',
      `expected euphoria or risk-on, got ${r.regime}`,
    );
    assert.ok(r.confidence > 0);
    assert.equal(r.components.length, 5);
  });

  it('classifies panic from strong risk-off inputs', () => {
    const r = classifyMarketRegime({
      sentimentScore: 5,
      breadthADRatio: 0.3,
      mcclellanOscillator: -200,
      vixLevel: 40,
      volTermShape: 'backwardation',
      rotationRegime: 'risk-off',
      curveShape: 'inverted',
    });
    assert.ok(
      r.regime === 'panic' || r.regime === 'risk-off',
      `expected panic or risk-off, got ${r.regime}`,
    );
  });

  it('confidence reflects vote agreement', () => {
    // All inputs agree → high confidence
    const unanimous = classifyMarketRegime({
      sentimentScore: 70,
      breadthADRatio: 1.5,
      mcclellanOscillator: 50,
      vixLevel: 14,
      rotationRegime: 'risk-on',
      curveShape: 'normal',
    });
    // Split inputs → lower confidence
    const split = classifyMarketRegime({
      sentimentScore: 70,   // risk-on
      vixLevel: 40,         // panic
      curveShape: 'inverted', // risk-off
    });
    assert.ok(
      unanimous.confidence >= split.confidence,
      `unanimous ${unanimous.confidence} should >= split ${split.confidence}`,
    );
  });

  it('recordRegime and detectRegimeTransition track history', () => {
    _resetRegimeHistory();
    const r1 = classifyMarketRegime({ sentimentScore: 70 });
    recordRegime(r1);
    const r2 = classifyMarketRegime({ sentimentScore: 10 });
    recordRegime(r2);

    assert.equal(getRegimeHistory().length, 2);
    const t = detectRegimeTransition();
    assert.equal(t.transitioned, true);
    assert.equal(t.current, r2.regime);
    assert.equal(t.previous, r1.regime);
  });
});

// ─── F-33 Tests ─────────────────────────────────────────────────

describe('F-33 Portfolio Risk Decomposition', () => {
  // Deterministic returns for reproducible tests
  const posA: import('../src/services/portfolio-risk.js').Position = {
    symbol: 'SPY', sector: 'Broad Market', weightPct: 60,
    returns: [0.01, -0.005, 0.008, -0.002, 0.012, 0.003, -0.01, 0.006, 0.004, -0.003],
  };
  const posB: import('../src/services/portfolio-risk.js').Position = {
    symbol: 'TLT', sector: 'Bonds', weightPct: 30,
    returns: [-0.003, 0.006, -0.002, 0.004, -0.005, 0.001, 0.007, -0.004, 0.002, 0.003],
  };
  const posC: import('../src/services/portfolio-risk.js').Position = {
    symbol: 'GLD', sector: 'Commodities', weightPct: 10,
    returns: [0.005, 0.002, -0.001, 0.003, 0.004, -0.006, 0.001, 0.002, -0.003, 0.001],
  };

  it('returns zero risk for empty portfolio', () => {
    const r = decomposePortfolioRisk([]);
    assert.equal(r.portfolioVolPct, 0);
    assert.equal(r.var95Pct, 0);
    assert.equal(r.sectorHHI, 0);
  });

  it('builds covariance matrix with correct dimensions', () => {
    const cov = buildCovarianceMatrix([posA, posB, posC]);
    assert.equal(cov.length, 3);
    assert.equal(cov[0]!.length, 3);
    // Symmetric: cov[0][1] === cov[1][0]
    assert.equal(cov[0]![1], cov[1]![0]);
    // Diagonal is variance (positive)
    assert.ok(cov[0]![0]! >= 0);
  });

  it('decomposes a 3-asset portfolio', () => {
    const r = decomposePortfolioRisk([posA, posB, posC]);
    assert.ok(r.portfolioVolPct > 0);
    assert.ok(r.var95Pct > 0);
    assert.ok(r.var99Pct > r.var95Pct);
    assert.equal(r.contributions.length, 3);
    // Variance contributions should roughly sum to 1
    const totalContrib = r.contributions.reduce((s, c) => s + c.varianceContribution, 0);
    assert.ok(Math.abs(totalContrib - 1) < 0.05, `variance contributions sum to ${totalContrib}`);
  });

  it('computes sector HHI', () => {
    const r = decomposePortfolioRisk([posA, posB, posC]);
    // 60² + 30² + 10² = 3600 + 900 + 100 = 4600
    assert.equal(r.sectorHHI, 4600);
  });

  it('diversification ratio >= 1 for multi-asset portfolio', () => {
    const r = decomposePortfolioRisk([posA, posB, posC]);
    assert.ok(r.diversificationRatio >= 1.0,
      `diversification ratio ${r.diversificationRatio} should be >= 1`);
  });

  it('concentrationWarning classifies HHI levels', () => {
    assert.equal(concentrationWarning(6000), 'highly-concentrated');
    assert.equal(concentrationWarning(3000), 'moderately-concentrated');
    assert.equal(concentrationWarning(1500), 'diversified');
  });
});
