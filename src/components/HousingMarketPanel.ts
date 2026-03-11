import { Panel } from './Panel';
import { t } from '@/services/i18n';
import { EconomicServiceClient } from '@/generated/client/worldmonitor/economic/v1/service_client';
import type { FredSeries } from '@/generated/client/worldmonitor/economic/v1/service_client';

const econClient = new EconomicServiceClient('', { fetch: (...args) => globalThis.fetch(...args) });

interface HousingMetric {
  id: string;
  label: string;
  group: 'prices' | 'rates' | 'supply' | 'demand';
  unit: string;
  format: 'index' | 'usd' | 'percent' | 'thousands';
  invertBullish?: boolean; // higher = worse for buyers
}

type GroupFilter = 'all' | 'prices' | 'rates' | 'supply' | 'demand';

const METRICS: HousingMetric[] = [
  // Prices
  { id: 'CSUSHPINSA',    label: 'Case-Shiller National',    group: 'prices', unit: '',  format: 'index' },
  { id: 'MSPUS',         label: 'Median Sale Price',         group: 'prices', unit: '$', format: 'usd' },
  { id: 'ASPUS',         label: 'Avg Sale Price',            group: 'prices', unit: '$', format: 'usd' },
  { id: 'MSPNHSUS',      label: 'Median New Home Price',     group: 'prices', unit: '$', format: 'usd' },
  // Rates
  { id: 'MORTGAGE30US',  label: '30Y Fixed Mortgage',        group: 'rates',  unit: '%', format: 'percent', invertBullish: true },
  { id: 'MORTGAGE15US',  label: '15Y Fixed Mortgage',        group: 'rates',  unit: '%', format: 'percent', invertBullish: true },
  { id: 'FEDFUNDS',      label: 'Fed Funds Rate',            group: 'rates',  unit: '%', format: 'percent', invertBullish: true },
  // Supply
  { id: 'HOUST',         label: 'Housing Starts (Total)',    group: 'supply', unit: 'K', format: 'thousands' },
  { id: 'HOUSTS',        label: 'Housing Starts (Single)',   group: 'supply', unit: 'K', format: 'thousands' },
  { id: 'PERMIT',        label: 'Building Permits',          group: 'supply', unit: 'K', format: 'thousands' },
  { id: 'MSACSR',        label: 'Months of Supply (New)',    group: 'supply', unit: 'mo', format: 'index' },
  // Demand
  { id: 'HSN1F',         label: 'New Home Sales',            group: 'demand', unit: 'K', format: 'thousands' },
  { id: 'EXHOSLUSM495S', label: 'Existing Home Sales',       group: 'demand', unit: 'K', format: 'thousands' },
  { id: 'MNMFS',         label: 'Mortgage Applications Index', group: 'demand', unit: '', format: 'index' },
];

const GROUP_COLORS: Record<HousingMetric['group'], string> = {
  prices:  '#ff9800',
  rates:   '#ef5350',
  supply:  '#42a5f5',
  demand:  '#66bb6a',
};

function formatValue(v: number, m: HousingMetric): string {
  if (!Number.isFinite(v)) return 'N/A';
  switch (m.format) {
    case 'usd':       return `$${(v / 1000).toFixed(0)}K`;
    case 'percent':   return `${v.toFixed(2)}%`;
    case 'thousands': return `${v.toFixed(0)}K`;
    case 'index':
    default:          return v.toFixed(1);
  }
}

function miniSparkline(obs: FredSeries['observations'] | undefined, color: string): string {
  if (!obs || obs.length < 3) return '';
  const recent = obs.slice(-24);
  const vals = recent.map(o => o.value).filter(v => Number.isFinite(v));
  if (!vals.length) return '';
  const mn = Math.min(...vals); const mx = Math.max(...vals);
  const range = mx - mn || 1;
  const W = 60; const H = 20; const P = 1;
  const pts = recent.map((o, i) => {
    const x = P + (i / (recent.length - 1)) * (W - P * 2);
    const y = P + (1 - (o.value - mn) / range) * (H - P * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" class="hm-spark"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.2"/></svg>`;
}

export class HousingMarketPanel extends Panel {
  private data = new Map<string, FredSeries>();
  private loading = true;
  private error: string | null = null;
  private groupFilter: GroupFilter = 'all';

  constructor() {
    super({ id: 'housing-market', title: t('panels.housingMarket') });
    void this.fetchData();
  }

  public async fetchData(): Promise<void> {
    this.loading = true;
    this.error = null;
    this.showLoading();
    const ids = METRICS.map(m => m.id);
    try {
      const res = await econClient.getFredSeriesBatch({ seriesIds: ids, limit: 24 });
      for (const [id, series] of Object.entries(res.results ?? {})) {
        this.data.set(id, series);
      }
      this.loading = false;
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to load housing data';
      this.loading = false;
    }
    if (this.element?.isConnected) this.renderPanel();
    setTimeout(() => { if (this.element?.isConnected) void this.fetchData(); }, 60 * 60 * 1000);
  }

  private latest(id: string): number | null {
    const s = this.data.get(id);
    if (!s?.observations?.length) return null;
    const sorted = [...s.observations].sort((a, b) => b.date.localeCompare(a.date));
    return sorted[0]?.value ?? null;
  }

  private yoy(id: string): number | null {
    const s = this.data.get(id);
    if (!s?.observations || s.observations.length < 13) return null;
    const sorted = [...s.observations].sort((a, b) => b.date.localeCompare(a.date));
    const curr = sorted[0]?.value;
    const prev = sorted[12]?.value;
    if (curr == null || prev == null || prev === 0) return null;
    return ((curr - prev) / Math.abs(prev)) * 100;
  }

  protected renderPanel(): void {
    if (this.loading) { this.showLoading(); return; }
    if (this.error) { this.showError(this.error); return; }

    const groups: GroupFilter[] = ['all', 'prices', 'rates', 'supply', 'demand'];
    const gBar = groups.map(g =>
      `<button class="hm-group-btn${this.groupFilter === g ? ' active' : ''}" data-group="${g}" style="${g !== 'all' ? `--gc:${GROUP_COLORS[g as HousingMetric['group']]}` : ''}">
        ${g.charAt(0).toUpperCase() + g.slice(1)}
      </button>`,
    ).join('');

    const visible = this.groupFilter === 'all'
      ? METRICS
      : METRICS.filter(m => m.group === this.groupFilter);

    // Mortgage affordability snapshot
    const mortgage30 = this.latest('MORTGAGE30US');
    const medPrice   = this.latest('MSPUS');
    const income = 75000; // rough US median household income
    let affordHtml = '';
    if (mortgage30 != null && medPrice != null) {
      const monthlyRate = (mortgage30 / 100) / 12;
      const n = 360; // 30Y
      const dp = medPrice * 0.2;
      const principal = medPrice - dp;
      const payment = (principal * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -n));
      const pti = (payment * 12) / income * 100;
      const ptiColor = pti > 35 ? '#ef5350' : pti > 28 ? '#ff9800' : '#66bb6a';
      affordHtml = `
        <div class="hm-afford">
          <span class="hm-afford-label">Affordability</span>
          <span class="hm-afford-val" style="color:${ptiColor}">~${pti.toFixed(0)}% of income</span>
          <span class="hm-afford-sub">($${payment.toFixed(0)}/mo on median home · 20% down)</span>
        </div>`;
    }

    const rows = visible.map(m => {
      const v = this.latest(m.id);
      const chgPct = this.yoy(m.id);
      const series = this.data.get(m.id);
      const gc = GROUP_COLORS[m.group];

      if (v == null) {
        return `<div class="hm-row hm-na"><span class="hm-label">${m.label}</span><span class="hm-na-text">N/A</span></div>`;
      }

      const isUp = chgPct != null && chgPct >= 0;
      const isBad = (m.invertBullish && isUp) || (!m.invertBullish && !isUp);
      const chgColor = chgPct == null ? '' : isBad ? '#ef5350' : '#66bb6a';
      const spark = miniSparkline(series?.observations, gc);

      return `
        <div class="hm-row">
          <span class="hm-group-dot" style="background:${gc}"></span>
          <span class="hm-label">${m.label}</span>
          <div class="hm-row-right">
            ${spark}
            <span class="hm-val">${formatValue(v, m)}</span>
            ${chgPct != null ? `<span class="hm-chg" style="color:${chgColor}">${chgPct >= 0 ? '▲' : '▼'}${Math.abs(chgPct).toFixed(1)}% YoY</span>` : ''}
          </div>
        </div>`;
    }).join('');

    const content = `
      <div class="hm-container">
        <div class="hm-toolbar">
          <div class="hm-group-bar">${gBar}</div>
        </div>
        ${affordHtml}
        <div class="hm-list">${rows}</div>
        <div class="yc-footer">Federal Reserve FRED · US Housing Market Indicators</div>
      </div>`;

    this.setContent(content);

    this.element?.querySelectorAll('.hm-group-btn').forEach(btn =>
      btn.addEventListener('click', e => {
        const g = (e.currentTarget as HTMLElement).dataset['group'] as GroupFilter;
        if (g) { this.groupFilter = g; this.renderPanel(); }
      }),
    );
  }
}
