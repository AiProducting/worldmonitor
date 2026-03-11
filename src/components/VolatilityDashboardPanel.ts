import { Panel } from './Panel';
import { t } from '@/services/i18n';
import { EconomicServiceClient } from '@/generated/client/worldmonitor/economic/v1/service_client';
import type { FredSeries } from '@/generated/client/worldmonitor/economic/v1/service_client';

const econClient = new EconomicServiceClient('', { fetch: (...args) => globalThis.fetch(...args) });

// Key volatility & risk series from FRED
interface MetricMeta {
  id: string;
  label: string;
  category: string;
  unit: string;
  warningAbove?: number;
  dangerAbove?: number;
  warningBelow?: number;
  dangerBelow?: number;
  invertRisk?: boolean; // true = lower = more risk (like yield curve)
}

const METRICS: MetricMeta[] = [
  // Equity volatility
  { id: 'VIXCLS',        label: 'VIX (Equity Fear)',         category: 'Vol',    unit: '', warningAbove: 20, dangerAbove: 30 },
  { id: 'VXNCLS',        label: 'VXN (Nasdaq Vol)',          category: 'Vol',    unit: '', warningAbove: 20, dangerAbove: 30 },
  // Rates & Curve
  { id: 'T10Y2Y',        label: '10Y-2Y Spread',            category: 'Rates',  unit: '%', dangerBelow: 0, warningBelow: 0.5, invertRisk: true },
  { id: 'T10Y3M',        label: '10Y-3M Spread',            category: 'Rates',  unit: '%', dangerBelow: 0, warningBelow: 0.5, invertRisk: true },
  { id: 'FEDFUNDS',      label: 'Fed Funds Rate',           category: 'Rates',  unit: '%' },
  // Credit spreads
  { id: 'BAA10Y',        label: 'Baa-Treasury Spread',      category: 'Credit', unit: '%', warningAbove: 2.5, dangerAbove: 3.5 },
  { id: 'BAMLH0A0HYM2', label: 'HY Spread (Option-Adj)',   category: 'Credit', unit: '%', warningAbove: 4.5, dangerAbove: 6.0 },
  { id: 'TEDRATE',       label: 'TED Spread',               category: 'Credit', unit: '%', warningAbove: 0.5, dangerAbove: 1.0 },
  // Stress indicators
  { id: 'NFCI',          label: 'Chicago NFCI',             category: 'Stress', unit: '', warningAbove: 0, dangerAbove: 0.5 },
  { id: 'STLFSI4',       label: 'St. Louis Stress Index',   category: 'Stress', unit: '', warningAbove: 0, dangerAbove: 0.5 },
  { id: 'KCFSI',         label: 'KC Fed Stress Index',      category: 'Stress', unit: '', warningAbove: 0, dangerAbove: 0.5 },
];

type CatFilter = 'all' | 'Vol' | 'Rates' | 'Credit' | 'Stress';

const CAT_COLORS: Record<string, string> = {
  Vol:    '#ff9800',
  Rates:  '#42a5f5',
  Credit: '#ef5350',
  Stress: '#ab47bc',
};

function getRiskLevel(m: MetricMeta, v: number): 'danger' | 'warning' | 'normal' {
  if (m.invertRisk) {
    if (m.dangerBelow != null && v <= m.dangerBelow) return 'danger';
    if (m.warningBelow != null && v <= m.warningBelow) return 'warning';
    return 'normal';
  }
  if (m.dangerAbove != null && v >= m.dangerAbove) return 'danger';
  if (m.warningAbove != null && v >= m.warningAbove) return 'warning';
  if (m.dangerBelow != null && v <= m.dangerBelow) return 'danger';
  if (m.warningBelow != null && v <= m.warningBelow) return 'warning';
  return 'normal';
}

const RISK_COLORS = { danger: '#ef5350', warning: '#ff9800', normal: '#66bb6a' };
const RISK_LABELS = { danger: 'High Risk', warning: 'Caution', normal: 'Normal' };

function sparkline(obs: FredSeries['observations'], color: string): string {
  if (!obs || obs.length < 2) return '';
  const recent = obs.slice(-20);
  const vals = recent.map(o => o.value).filter(v => Number.isFinite(v));
  if (!vals.length) return '';
  const mn = Math.min(...vals);
  const mx = Math.max(...vals);
  const range = mx - mn || 1;
  const W = 60; const H = 18; const PAD = 1;
  const pts = recent.map((o, i) => {
    const x = PAD + (i / (recent.length - 1)) * (W - PAD * 2);
    const y = PAD + (1 - (o.value - mn) / range) * (H - PAD * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return `<svg viewBox="0 0 ${W} ${H}" class="vd-spark" width="${W}" height="${H}"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.2"/></svg>`;
}

export class VolatilityDashboardPanel extends Panel {
  private data: Map<string, FredSeries> = new Map();
  private loading = true;
  private error: string | null = null;
  private catFilter: CatFilter = 'all';

  constructor() {
    super({ id: 'volatility-dashboard', title: t('panels.volatilityDashboard') });
    void this.fetchData();
  }

  public async fetchData(): Promise<void> {
    this.loading = true;
    this.error = null;
    this.showLoading();
    const ids = METRICS.map(m => m.id);
    try {
      const res = await econClient.getFredSeriesBatch({ seriesIds: ids, limit: 20 });
      for (const [id, series] of Object.entries(res.results ?? {})) {
        this.data.set(id, series);
      }
      this.loading = false;
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to load volatility data';
      this.loading = false;
    }
    if (this.element?.isConnected) this.renderPanel();
    setTimeout(() => { if (this.element?.isConnected) void this.fetchData(); }, 15 * 60 * 1000);
  }

  private latest(id: string): number | null {
    const s = this.data.get(id);
    if (!s?.observations?.length) return null;
    const sorted = [...s.observations].sort((a, b) => b.date.localeCompare(a.date));
    return sorted[0]?.value ?? null;
  }

  private prev(id: string): number | null {
    const s = this.data.get(id);
    if (!s?.observations || s.observations.length < 2) return null;
    const sorted = [...s.observations].sort((a, b) => b.date.localeCompare(a.date));
    return sorted[1]?.value ?? null;
  }

  private riskSummary(): { danger: number; warning: number; normal: number } {
    const counts = { danger: 0, warning: 0, normal: 0 };
    for (const m of METRICS) {
      const v = this.latest(m.id);
      if (v == null) continue;
      counts[getRiskLevel(m, v)]++;
    }
    return counts;
  }

  protected renderPanel(): void {
    if (this.loading) { this.showLoading(); return; }
    if (this.error) { this.showError(this.error); return; }

    const cats: CatFilter[] = ['all', 'Vol', 'Rates', 'Credit', 'Stress'];
    const catBtns = cats.map(c =>
      `<button class="vd-cat-btn${this.catFilter === c ? ' active' : ''}" data-cat="${c}" style="${c !== 'all' ? `--cat-color:${CAT_COLORS[c]}` : ''}">${c === 'all' ? 'All' : c}</button>`,
    ).join('');

    const summary = this.riskSummary();
    const totalWithData = summary.danger + summary.warning + summary.normal;
    const overallRisk = summary.danger > 0 ? 'danger' : summary.warning > 2 ? 'warning' : 'normal';

    const visibleMetrics = this.catFilter === 'all'
      ? METRICS
      : METRICS.filter(m => m.category === this.catFilter);

    const rows = visibleMetrics.map(m => {
      const v = this.latest(m.id);
      const p = this.prev(m.id);
      const series = this.data.get(m.id);
      const catColor = CAT_COLORS[m.category] ?? '#90a4ae';

      if (v == null) {
        return `<div class="vd-row vd-na"><span class="vd-label">${m.label}</span><span class="vd-na-text">N/A</span></div>`;
      }

      const risk = getRiskLevel(m, v);
      const riskColor = RISK_COLORS[risk];
      const chg = p != null ? v - p : null;
      const spark = series ? sparkline(series.observations, riskColor) : '';
      const valStr = `${v.toFixed(2)}${m.unit}`;

      return `
        <div class="vd-row">
          <div class="vd-row-left">
            <span class="vd-cat-dot" style="background:${catColor}"></span>
            <span class="vd-label">${m.label}</span>
          </div>
          <div class="vd-row-right">
            ${spark}
            <span class="vd-val" style="color:${riskColor}">${valStr}</span>
            ${chg != null ? `<span class="vd-chg ${chg >= 0 ? 'pos' : 'neg'}">${chg >= 0 ? '▲' : '▼'}${Math.abs(chg).toFixed(2)}</span>` : ''}
            <span class="vd-risk ${risk}" style="color:${riskColor}">${RISK_LABELS[risk]}</span>
          </div>
        </div>`;
    }).join('');

    const content = `
      <div class="vd-container">
        <div class="vd-toolbar">
          <div class="vd-cat-bar">${catBtns}</div>
          <div class="vd-overall vd-risk-${overallRisk}">
            Overall: <span class="vd-overall-label">${RISK_LABELS[overallRisk]}</span>
            <span class="vd-risk-counts">
              ${summary.danger > 0 ? `<span class="vd-risk-danger">${summary.danger} ⚠</span>` : ''}
              ${summary.warning > 0 ? `<span class="vd-risk-warn">${summary.warning} ⚡</span>` : ''}
              <span class="vd-risk-ok">${summary.normal}/${totalWithData} OK</span>
            </span>
          </div>
        </div>
        <div class="vd-list">${rows}</div>
        <div class="yc-footer">FRED · VIX/VXNCLS/NFCI/KCFSI/TED/HY spreads</div>
      </div>`;

    this.setContent(content);

    this.element?.querySelectorAll('.vd-cat-btn').forEach(btn =>
      btn.addEventListener('click', e => {
        const c = (e.currentTarget as HTMLElement).dataset['cat'] as CatFilter;
        if (c) { this.catFilter = c; this.renderPanel(); }
      }),
    );
  }
}
