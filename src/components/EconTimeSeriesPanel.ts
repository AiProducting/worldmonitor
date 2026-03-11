import { Panel } from './Panel';
import { t } from '@/services/i18n';
import { EconomicServiceClient } from '@/generated/client/worldmonitor/economic/v1/service_client';
import type { FredObservation } from '@/generated/client/worldmonitor/economic/v1/service_client';

const econClient = new EconomicServiceClient('', { fetch: (...args) => globalThis.fetch(...args) });

// Curated series catalogue
interface SeriesMeta { id: string; label: string; category: string; description: string; }
type Category = 'Growth' | 'Prices' | 'Labor' | 'Credit' | 'Sentiment' | 'Money';

const SERIES: SeriesMeta[] = [
  // Growth
  { id: 'GDP',        label: 'US GDP',              category: 'Growth',    description: 'US Gross Domestic Product (billions, SAAR)' },
  { id: 'GDPC1',      label: 'Real GDP',             category: 'Growth',    description: 'Real Gross Domestic Product (chained 2017$, SAAR)' },
  { id: 'INDPRO',     label: 'Industrial Prod.',     category: 'Growth',    description: 'Industrial Production Index' },
  { id: 'RETAILSL',   label: 'Retail Sales',         category: 'Growth',    description: 'Advance Retail Sales: Retail Trade (millions)' },
  // Prices
  { id: 'CPIAUCSL',   label: 'CPI (All Items)',      category: 'Prices',    description: 'Consumer Price Index for All Urban Consumers' },
  { id: 'CPILFESL',   label: 'Core CPI',             category: 'Prices',    description: 'CPI excl. Food & Energy' },
  { id: 'PCEPI',      label: 'PCE Price Index',      category: 'Prices',    description: 'Personal Consumption Expenditures Price Index' },
  { id: 'PPIFES',     label: 'PPI (Core)',            category: 'Prices',    description: 'PPI: Finished Goods Less Foods & Energy' },
  // Labor
  { id: 'UNRATE',     label: 'Unemployment',         category: 'Labor',     description: 'Civilian Unemployment Rate (%)' },
  { id: 'PAYEMS',     label: 'Nonfarm Payrolls',     category: 'Labor',     description: 'All Employees: Total Nonfarm (thousands)' },
  { id: 'ICSA',       label: 'Initial Claims',       category: 'Labor',     description: 'Initial Jobless Claims (weekly, thousands)' },
  { id: 'JTSJOL',     label: 'JOLTS Openings',       category: 'Labor',     description: 'Job Openings: Total Nonfarm (thousands)' },
  // Credit
  { id: 'FEDFUNDS',   label: 'Fed Funds Rate',       category: 'Credit',    description: 'Effective Federal Funds Rate (%)' },
  { id: 'T10Y2Y',     label: '10Y-2Y Spread',        category: 'Credit',    description: '10-Year minus 2-Year Treasury Yield Spread (%)' },
  { id: 'BAA10Y',     label: 'Corp. Credit Spread',  category: 'Credit',    description: 'Moody\'s Baa Corporate Bond Yield minus 10Y Treasury (%)' },
  { id: 'MORTGAGE30US', label: '30Y Mortgage Rate',  category: 'Credit',    description: '30-Year Fixed Rate Mortgage Average (%)' },
  // Money
  { id: 'M2SL',       label: 'M2 Money Supply',      category: 'Money',     description: 'M2 Money Stock (billions, seasonally adjusted)' },
  { id: 'WALCL',      label: 'Fed Balance Sheet',    category: 'Money',     description: 'Assets: Total Assets of Federal Reserve (millions)' },
  // Sentiment
  { id: 'UMCSENT',    label: 'Consumer Sentiment',   category: 'Sentiment', description: 'University of Michigan: Consumer Sentiment' },
  { id: 'USEPUINDXD', label: 'Policy Uncertainty',  category: 'Sentiment', description: 'Economic Policy Uncertainty Index for US' },
  { id: 'SAHMREALTIME', label: 'Sahm Rule',          category: 'Sentiment', description: 'Sahm Rule Recession Indicator (real-time estimate)' },
];

const CATEGORIES: Category[] = ['Growth', 'Prices', 'Labor', 'Credit', 'Money', 'Sentiment'];

const CAT_COLORS: Record<Category, string> = {
  Growth:    '#4caf50',
  Prices:    '#ff9800',
  Labor:     '#42a5f5',
  Credit:    '#ef5350',
  Money:     '#ab47bc',
  Sentiment: '#26c6da',
};

function fmtVal(v: number, id: string): string {
  if (['GDP', 'GDPC1', 'M2SL', 'WALCL', 'PAYEMS', 'ICSA', 'JTSJOL', 'RETAILSL'].includes(id)) {
    const unit = v >= 1_000_000 ? 'T' : v >= 1_000 ? 'B' : '';
    const dv = v >= 1_000_000 ? v / 1_000_000 : v >= 1_000 ? v / 1_000 : v;
    return dv.toFixed(1) + unit;
  }
  return v.toFixed(2);
}

function buildSvgPath(obs: FredObservation[], w: number, h: number, pad = 12): string {
  if (obs.length < 2) return '';
  const vals = obs.map(o => o.value).filter(v => Number.isFinite(v));
  const mn = Math.min(...vals);
  const mx = Math.max(...vals);
  const range = mx - mn || 1;
  const xStep = (w - pad * 2) / (obs.length - 1);
  const pts = obs.map((o, i) => {
    const x = pad + i * xStep;
    const y = pad + (1 - (o.value - mn) / range) * (h - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return pts;
}

function yAxisLabels(obs: FredObservation[], h: number, pad: number, id: string): string {
  if (!obs.length) return '';
  const vals = obs.map(o => o.value).filter(v => Number.isFinite(v));
  const mn = Math.min(...vals);
  const mx = Math.max(...vals);
  const mid = (mn + mx) / 2;
  const fmt = (v: number) => fmtVal(v, id);
  return [
    `<text x="4" y="${pad + 4}" class="ets-axis-label">${fmt(mx)}</text>`,
    `<text x="4" y="${(h / 2) + 4}" class="ets-axis-label">${fmt(mid)}</text>`,
    `<text x="4" y="${h - pad + 4}" class="ets-axis-label">${fmt(mn)}</text>`,
  ].join('');
}

function xAxisLabels(obs: FredObservation[], w: number, h: number, pad: number): string {
  if (!obs.length) return '';
  const first = obs[0]!.date.slice(0, 7);
  const last  = obs[obs.length - 1]!.date.slice(0, 7);
  const midIdx = Math.floor(obs.length / 2);
  const mid = obs[midIdx]!.date.slice(0, 7);
  return [
    `<text x="${pad}" y="${h - 2}" class="ets-axis-label" text-anchor="start">${first}</text>`,
    `<text x="${w / 2}" y="${h - 2}" class="ets-axis-label" text-anchor="middle">${mid}</text>`,
    `<text x="${w - pad}" y="${h - 2}" class="ets-axis-label" text-anchor="end">${last}</text>`,
  ].join('');
}

export class EconTimeSeriesPanel extends Panel {
  private selectedId = 'FEDFUNDS';
  private cache: Map<string, FredObservation[]> = new Map();
  private loadingId: string | null = null;
  private catFilter: Category | 'all' = 'all';

  constructor() {
    super({ id: 'econ-time-series', title: t('panels.econTimeSeries') });
    void this.loadSeries(this.selectedId);
  }

  private async loadSeries(id: string): Promise<void> {
    if (this.cache.has(id)) { this.loadingId = null; this.renderPanel(); return; }
    this.loadingId = id;
    this.renderPanel();
    try {
      const res = await econClient.getFredSeries({ seriesId: id, limit: 120 });
      if (res.series?.observations) {
        this.cache.set(id, res.series.observations);
      }
    } catch {
      this.cache.set(id, []);
    }
    this.loadingId = null;
    if (this.element?.isConnected) this.renderPanel();
  }

  private visibleSeries(): SeriesMeta[] {
    if (this.catFilter === 'all') return SERIES;
    return SERIES.filter(s => s.category === this.catFilter);
  }

  protected renderPanel(): void {
    const selectedMeta = SERIES.find(s => s.id === this.selectedId)!;
    const obs = this.cache.get(this.selectedId) ?? [];
    const isLoading = this.loadingId === this.selectedId;
    const catColor = CAT_COLORS[selectedMeta.category as Category] ?? '#90a4ae';

    // Chart SVG (responsive: use fixed 340x130)
    const W = 340;
    const H = 120;
    const PAD = 36;
    let chartHtml = '';
    if (isLoading) {
      chartHtml = `<div class="ets-chart-loading">Loading…</div>`;
    } else if (!obs.length) {
      chartHtml = `<div class="ets-chart-loading">No data</div>`;
    } else {
      const pts = buildSvgPath(obs, W, H, PAD);
      const yLabels = yAxisLabels(obs, H, PAD, this.selectedId);
      const xLabels = xAxisLabels(obs, W, H, PAD);
      const current = obs[obs.length - 1]?.value ?? 0;
      const previous = obs.length > 12 ? obs[obs.length - 13]?.value ?? null : null;
      const chg = previous != null ? ((current - previous) / Math.abs(previous)) * 100 : null;
      const chgStr = chg != null ? `${chg >= 0 ? '+' : ''}${chg.toFixed(1)}% YoY` : '';
      const vals = obs.map(o => o.value).filter(v => Number.isFinite(v));
      const mn = Math.min(...vals);
      const mx = Math.max(...vals);
      const fillY = PAD + (1 - (current - mn) / (mx - mn || 1)) * (H - PAD * 2);
      const fillPts = `${PAD.toFixed(1)},${H - PAD} ${pts} ${(W - PAD).toFixed(1)},${H - PAD}`;

      chartHtml = `
        <div class="ets-chart-header">
          <div class="ets-chart-val">${fmtVal(current, this.selectedId)}<span class="ets-chart-units">${selectedMeta.description}</span></div>
          ${chgStr ? `<div class="ets-chart-yoy ${chg! >= 0 ? 'pos' : 'neg'}">${chgStr}</div>` : ''}
        </div>
        <svg viewBox="0 0 ${W} ${H}" class="ets-svg" preserveAspectRatio="none">
          <defs>
            <linearGradient id="ets-grad-${this.selectedId.replace(/[^a-z0-9]/gi,'')}" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="${catColor}" stop-opacity="0.35"/>
              <stop offset="100%" stop-color="${catColor}" stop-opacity="0.03"/>
            </linearGradient>
          </defs>
          ${yLabels}
          ${xLabels}
          <polygon points="${fillPts}" fill="url(#ets-grad-${this.selectedId.replace(/[^a-z0-9]/gi,'')})" />
          <polyline points="${pts}" fill="none" stroke="${catColor}" stroke-width="1.5" stroke-linejoin="round"/>
          <circle cx="${(W - PAD).toFixed(1)}" cy="${fillY.toFixed(1)}" r="3" fill="${catColor}"/>
        </svg>`;
    }

    // Category filter bar
    const catBtns = ['all', ...CATEGORIES].map(c =>
      `<button class="ets-cat-btn${this.catFilter === c ? ' active' : ''}" data-cat="${c}" style="${c !== 'all' ? `--cat-color:${CAT_COLORS[c as Category]}` : ''}">
        ${c === 'all' ? 'All' : c}
      </button>`,
    ).join('');

    // Series list
    const listItems = this.visibleSeries().map(s => {
      const isSelected = s.id === this.selectedId;
      const isThisLoading = this.loadingId === s.id;
      const cached = this.cache.get(s.id);
      const latestVal = cached?.length ? fmtVal(cached[cached.length - 1]!.value, s.id) : '';
      const cc = CAT_COLORS[s.category as Category] ?? '#90a4ae';
      return `
        <div class="ets-series-item${isSelected ? ' selected' : ''}" data-id="${s.id}" style="--item-color:${cc}">
          <span class="ets-series-label">${s.label}</span>
          ${latestVal ? `<span class="ets-series-val">${latestVal}</span>` : ''}
          ${isThisLoading ? `<span class="ets-spin">⟳</span>` : ''}
        </div>`;
    }).join('');

    const content = `
      <div class="ets-container">
        <div class="ets-sidebar">
          <div class="ets-cat-bar">${catBtns}</div>
          <div class="ets-series-list">${listItems}</div>
        </div>
        <div class="ets-main">
          <div class="ets-chart-area">${chartHtml}</div>
          <div class="ets-series-meta">
            <span class="ets-meta-id">${this.selectedId}</span>
            <span class="ets-meta-cat" style="color:${catColor}">${selectedMeta.category}</span>
            <span class="ets-meta-freq">128 observations · FRED</span>
          </div>
        </div>
      </div>`;

    this.setContent(content);

    this.element?.querySelectorAll('.ets-series-item').forEach(el =>
      el.addEventListener('click', e => {
        const id = (e.currentTarget as HTMLElement).dataset['id'];
        if (id && id !== this.selectedId) {
          this.selectedId = id;
          void this.loadSeries(id);
        }
      }),
    );
    this.element?.querySelectorAll('.ets-cat-btn').forEach(btn =>
      btn.addEventListener('click', e => {
        const c = (e.currentTarget as HTMLElement).dataset['cat'] as Category | 'all';
        if (c) { this.catFilter = c; this.renderPanel(); }
      }),
    );
  }
}
