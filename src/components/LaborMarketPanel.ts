import { Panel } from './Panel';
import { t } from '@/services/i18n';
import { EconomicServiceClient } from '@/generated/client/worldmonitor/economic/v1/service_client';
import type { FredSeries } from '@/generated/client/worldmonitor/economic/v1/service_client';

const econClient = new EconomicServiceClient('', { fetch: (...args) => globalThis.fetch(...args) });

interface LaborMetric {
  id: string;
  label: string;
  group: 'unemployment' | 'employment' | 'wages' | 'claims';
  unit: string;
  format: 'percent' | 'thousands' | 'index' | 'dollars';
  invertBullish?: boolean; // higher = worse
}

type GroupFilter = 'all' | 'unemployment' | 'employment' | 'wages' | 'claims';

const METRICS: LaborMetric[] = [
  // Unemployment
  { id: 'UNRATE',     label: 'Unemployment Rate (U3)',    group: 'unemployment', unit: '%', format: 'percent', invertBullish: true },
  { id: 'U6RATE',     label: 'Underemployment (U6)',      group: 'unemployment', unit: '%', format: 'percent', invertBullish: true },
  { id: 'CIVPART',    label: 'Participation Rate',        group: 'unemployment', unit: '%', format: 'percent' },
  { id: 'EMRATIO',    label: 'Employment-Pop Ratio',      group: 'unemployment', unit: '%', format: 'percent' },
  // Employment
  { id: 'PAYEMS',     label: 'Nonfarm Payrolls',          group: 'employment', unit: 'K',  format: 'thousands' },
  { id: 'MANEMP',     label: 'Manufacturing Jobs',        group: 'employment', unit: 'K',  format: 'thousands' },
  { id: 'CES7000000001', label: 'Leisure & Hospitality', group: 'employment', unit: 'K',  format: 'thousands' },
  { id: 'JTSJOL',     label: 'JOLTS Job Openings',        group: 'employment', unit: 'K',  format: 'thousands' },
  { id: 'JTSQUR',     label: 'Quit Rate',                 group: 'employment', unit: '%',  format: 'percent' },
  // Wages
  { id: 'AHETPI',     label: 'Avg Hourly Earnings',       group: 'wages',      unit: '$',  format: 'dollars' },
  { id: 'CES0500000003', label: 'Avg Weekly Earnings',   group: 'wages',      unit: '$',  format: 'dollars' },
  { id: 'LES1252881600Q', label: 'Median Weekly Earnings', group: 'wages',    unit: '$',  format: 'dollars' },
  // Claims
  { id: 'ICSA',       label: 'Initial Jobless Claims',    group: 'claims',     unit: 'K',  format: 'thousands', invertBullish: true },
  { id: 'CCSA',       label: 'Continued Claims',          group: 'claims',     unit: 'K',  format: 'thousands', invertBullish: true },
  { id: 'IC4WSA',     label: '4-Week Avg Claims',         group: 'claims',     unit: 'K',  format: 'thousands', invertBullish: true },
];

const GROUP_COLORS: Record<LaborMetric['group'], string> = {
  unemployment: '#ef5350',
  employment:   '#66bb6a',
  wages:        '#ff9800',
  claims:       '#ab47bc',
};

function formatValue(v: number, m: LaborMetric): string {
  if (!Number.isFinite(v)) return 'N/A';
  switch (m.format) {
    case 'percent':   return `${v.toFixed(1)}%`;
    case 'thousands': {
      if (v >= 1000) return `${(v / 1000).toFixed(1)}M`;
      return `${v.toFixed(0)}K`;
    }
    case 'dollars':   return `$${v.toFixed(2)}`;
    case 'index':
    default:          return v.toFixed(1);
  }
}

function miniSparkline(obs: FredSeries['observations'] | undefined, color: string): string {
  if (!obs || obs.length < 3) return '';
  const recent = obs.slice(-20);
  const vals = recent.map(o => o.value).filter(v => Number.isFinite(v));
  if (!vals.length) return '';
  const mn = Math.min(...vals); const mx = Math.max(...vals);
  const range = mx - mn || 1;
  const W = 55; const H = 18; const P = 1;
  const pts = recent.map((o, i) => {
    const x = P + (i / (recent.length - 1)) * (W - P * 2);
    const y = P + (1 - (o.value - mn) / range) * (H - P * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" class="lm-spark"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.2"/></svg>`;
}

export class LaborMarketPanel extends Panel {
  private data = new Map<string, FredSeries>();
  private loading = true;
  private error: string | null = null;
  private groupFilter: GroupFilter = 'all';

  constructor() {
    super({ id: 'labor-market', title: t('panels.laborMarket') });
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
      this.error = err instanceof Error ? err.message : 'Failed to load labor data';
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

  private mom(id: string): number | null {
    const s = this.data.get(id);
    if (!s?.observations || s.observations.length < 2) return null;
    const sorted = [...s.observations].sort((a, b) => b.date.localeCompare(a.date));
    const curr = sorted[0]?.value;
    const prev = sorted[1]?.value;
    if (curr == null || prev == null || prev === 0) return null;
    return ((curr - prev) / Math.abs(prev)) * 100;
  }

  private laborSummary() {
    const unrate = this.latest('UNRATE');
    const payrolls = this.latest('PAYEMS');
    const payrollMom = this.mom('PAYEMS');
    const claims = this.latest('ICSA');
    return { unrate, payrolls, payrollMom, claims };
  }

  protected renderPanel(): void {
    if (this.loading) { this.showLoading(); return; }
    if (this.error) { this.showError(this.error); return; }

    const groups: GroupFilter[] = ['all', 'unemployment', 'employment', 'wages', 'claims'];
    const gBar = groups.map(g => {
      const label = g === 'all' ? 'All' : g.charAt(0).toUpperCase() + g.slice(1);
      const gc = g !== 'all' ? GROUP_COLORS[g as LaborMetric['group']] : '';
      return `<button class="lm-group-btn${this.groupFilter === g ? ' active' : ''}" data-group="${g}" style="${gc ? `--gc:${gc}` : ''}">${label}</button>`;
    }).join('');

    // Summary header
    const { unrate, payrollMom } = this.laborSummary();
    const unrateColor = unrate != null ? (unrate > 5 ? '#ef5350' : unrate > 4 ? '#ff9800' : '#66bb6a') : '';
    const summaryHtml = `
      <div class="lm-summary">
        ${unrate != null ? `<div class="lm-sum-item"><span class="lm-sum-label">Unemployment</span><span class="lm-sum-val" style="color:${unrateColor}">${unrate.toFixed(1)}%</span></div>` : ''}
        ${payrollMom != null ? `<div class="lm-sum-item"><span class="lm-sum-label">Payrolls MoM</span><span class="lm-sum-val ${payrollMom >= 0 ? 'pos' : 'neg'}">${payrollMom >= 0 ? '+' : ''}${payrollMom.toFixed(1)}%</span></div>` : ''}
      </div>`;

    const visible = this.groupFilter === 'all'
      ? METRICS
      : METRICS.filter(m => m.group === this.groupFilter);

    const rows = visible.map(m => {
      const v      = this.latest(m.id);
      const yoyPct = this.yoy(m.id);
      const series = this.data.get(m.id);
      const gc     = GROUP_COLORS[m.group];

      if (v == null) {
        return `<div class="lm-row lm-na"><span class="lm-label">${m.label}</span><span class="lm-na-text">N/A</span></div>`;
      }

      const isUp = yoyPct != null && yoyPct >= 0;
      const isBad = (m.invertBullish && isUp) || (!m.invertBullish && !isUp);
      const chgColor = yoyPct == null ? '' : (isBad ? '#ef5350' : '#66bb6a');
      const spark = miniSparkline(series?.observations, gc);

      return `
        <div class="lm-row">
          <span class="lm-group-dot" style="background:${gc}"></span>
          <span class="lm-label">${m.label}</span>
          <div class="lm-row-right">
            ${spark}
            <span class="lm-val">${formatValue(v, m)}</span>
            ${yoyPct != null ? `<span class="lm-chg" style="color:${chgColor}">${yoyPct >= 0 ? '▲' : '▼'}${Math.abs(yoyPct).toFixed(1)}%</span>` : ''}
          </div>
        </div>`;
    }).join('');

    const content = `
      <div class="lm-container">
        <div class="lm-toolbar"><div class="lm-group-bar">${gBar}</div></div>
        ${summaryHtml}
        <div class="lm-list">${rows}</div>
        <div class="yc-footer">Bureau of Labor Statistics · Federal Reserve FRED</div>
      </div>`;

    this.setContent(content);

    this.element?.querySelectorAll('.lm-group-btn').forEach(btn =>
      btn.addEventListener('click', e => {
        const g = (e.currentTarget as HTMLElement).dataset['group'] as GroupFilter;
        if (g) { this.groupFilter = g; this.renderPanel(); }
      }),
    );
  }
}
