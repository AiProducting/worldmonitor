import { Panel } from './Panel';
import { t } from '@/services/i18n';
import { EconomicServiceClient } from '@/generated/client/worldmonitor/economic/v1/service_client';
import type { FredSeries } from '@/generated/client/worldmonitor/economic/v1/service_client';

const econClient = new EconomicServiceClient('', { fetch: (...args) => globalThis.fetch(...args) });

interface MoneyMetric {
  id: string;
  label: string;
  group: 'aggregates' | 'fed' | 'velocity';
  unit: 'billions' | 'trillions' | 'ratio' | 'index';
}

type GroupFilter = 'all' | 'aggregates' | 'fed' | 'velocity';

const METRICS: MoneyMetric[] = [
  // Monetary aggregates
  { id: 'M1SL',     label: 'M1 Money Stock',         group: 'aggregates', unit: 'billions' },
  { id: 'M2SL',     label: 'M2 Money Stock',         group: 'aggregates', unit: 'billions' },
  { id: 'MABMM301USM189S', label: 'Broad Money (M3 proxy)', group: 'aggregates', unit: 'billions' },
  { id: 'AMBSL',    label: 'Adjusted Monetary Base', group: 'aggregates', unit: 'billions' },
  { id: 'BOGMBASE', label: 'Monetary Base',          group: 'aggregates', unit: 'billions' },
  // Fed balance sheet
  { id: 'WALCL',    label: 'Fed Total Assets',       group: 'fed',        unit: 'billions' },
  { id: 'WDTGAL',   label: 'Fed: US Treasury',       group: 'fed',        unit: 'billions' },
  { id: 'WSHOMCB',  label: 'Fed: MBS Holdings',      group: 'fed',        unit: 'billions' },
  { id: 'WLRRAL',   label: 'Fed: Reserve Balances',  group: 'fed',        unit: 'billions' },
  // Velocity & credit
  { id: 'M2V',      label: 'M2 Velocity',            group: 'velocity',   unit: 'ratio' },
  { id: 'M1V',      label: 'M1 Velocity',            group: 'velocity',   unit: 'ratio' },
  { id: 'TOTALSL',  label: 'Consumer Credit (total)', group: 'velocity',  unit: 'billions' },
];

const GROUP_COLORS: Record<MoneyMetric['group'], string> = {
  aggregates: '#42a5f5',
  fed:        '#ab47bc',
  velocity:   '#ff9800',
};

function formatMoney(v: number, unit: MoneyMetric['unit']): string {
  if (!Number.isFinite(v)) return 'N/A';
  if (unit === 'ratio' || unit === 'index') return v.toFixed(2);
  // billions → humanize
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}T`;
  if (v >= 1_000)     return `$${(v / 1_000).toFixed(2)}T`;
  return `$${v.toFixed(0)}B`;
}

function yoyRate(obs: FredSeries['observations'] | undefined): number | null {
  if (!obs || obs.length < 13) return null;
  const sorted = [...obs].sort((a, b) => b.date.localeCompare(a.date));
  const curr = sorted[0]?.value;
  const prev = sorted[12]?.value;
  if (curr == null || prev == null || prev === 0) return null;
  return ((curr - prev) / Math.abs(prev)) * 100;
}

function miniSparkline(obs: FredSeries['observations'] | undefined, color: string): string {
  if (!obs || obs.length < 3) return '';
  const recent = obs.slice(-18);
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
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" class="ms-spark"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.2"/></svg>`;
}

export class MoneySupplyPanel extends Panel {
  private data = new Map<string, FredSeries>();
  private loading = true;
  private error: string | null = null;
  private groupFilter: GroupFilter = 'all';

  constructor() {
    super({ id: 'money-supply', title: t('panels.moneySupply') });
    void this.fetchData();
  }

  public async fetchData(): Promise<void> {
    this.loading = true;
    this.error = null;
    this.showLoading();
    try {
      const res = await econClient.getFredSeriesBatch({ seriesIds: METRICS.map(m => m.id), limit: 24 });
      for (const [id, series] of Object.entries(res.results ?? {})) {
        this.data.set(id, series);
      }
      this.loading = false;
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to load money supply data';
      this.loading = false;
    }
    if (this.element?.isConnected) this.renderPanel();
    setTimeout(() => { if (this.element?.isConnected) void this.fetchData(); }, 60 * 60 * 1000);
  }

  private latest(id: string): number | null {
    const s = this.data.get(id);
    if (!s?.observations?.length) return null;
    return [...s.observations].sort((a, b) => b.date.localeCompare(a.date))[0]?.value ?? null;
  }

  protected renderPanel(): void {
    if (this.loading) { this.showLoading(); return; }
    if (this.error) { this.showError(this.error); return; }

    const groups: GroupFilter[] = ['all', 'aggregates', 'fed', 'velocity'];
    const gBar = groups.map(g => {
      const gc = g !== 'all' ? GROUP_COLORS[g as MoneyMetric['group']] : '';
      return `<button class="ms-group-btn${this.groupFilter === g ? ' active' : ''}" data-group="${g}" style="${gc ? `--gc:${gc}` : ''}">${g === 'all' ? 'All' : g.charAt(0).toUpperCase() + g.slice(1)}</button>`;
    }).join('');

    // M2 YoY growth summary
    const m2Series = this.data.get('M2SL');
    const m2Yoy = yoyRate(m2Series?.observations);
    const fedAssets = this.latest('WALCL');
    const m2 = this.latest('M2SL');

    const summaryHtml = `
      <div class="ms-summary">
        ${m2 != null ? `<div class="ms-sum-item"><span class="ms-sum-label">M2</span><span class="ms-sum-val">${formatMoney(m2, 'billions')}</span></div>` : ''}
        ${m2Yoy != null ? `<div class="ms-sum-item"><span class="ms-sum-label">M2 YoY</span><span class="ms-sum-val ${m2Yoy >= 0 ? 'pos' : 'neg'}">${m2Yoy >= 0 ? '+' : ''}${m2Yoy.toFixed(1)}%</span></div>` : ''}
        ${fedAssets != null ? `<div class="ms-sum-item"><span class="ms-sum-label">Fed BS</span><span class="ms-sum-val">${formatMoney(fedAssets, 'billions')}</span></div>` : ''}
      </div>`;

    const visible = this.groupFilter === 'all'
      ? METRICS
      : METRICS.filter(m => m.group === this.groupFilter);

    const rows = visible.map(metric => {
      const v = this.latest(metric.id);
      const series = this.data.get(metric.id);
      const yoy = yoyRate(series?.observations);
      const gc = GROUP_COLORS[metric.group];

      if (v == null) {
        return `<div class="ms-row ms-na"><span class="ms-label">${metric.label}</span><span class="ms-na-text">N/A</span></div>`;
      }

      const spark = miniSparkline(series?.observations, gc);
      const yoyColor = yoy == null ? '' : yoy >= 10 ? '#ff9800' : yoy >= 5 ? '#ffca28' : yoy >= 0 ? '#66bb6a' : '#42a5f5';

      return `
        <div class="ms-row">
          <span class="ms-group-dot" style="background:${gc}"></span>
          <span class="ms-label">${metric.label}</span>
          <div class="ms-row-right">
            ${spark}
            <span class="ms-val">${formatMoney(v, metric.unit)}</span>
            ${yoy != null ? `<span class="ms-chg" style="color:${yoyColor}">${yoy >= 0 ? '+' : ''}${yoy.toFixed(1)}%</span>` : ''}
          </div>
        </div>`;
    }).join('');

    const content = `
      <div class="ms-container">
        <div class="ms-toolbar"><div class="ms-group-bar">${gBar}</div></div>
        ${summaryHtml}
        <div class="ms-list">${rows}</div>
        <div class="yc-footer">Federal Reserve H.4.1 · H.6 · FRED monetary aggregates</div>
      </div>`;

    this.setContent(content);

    this.element?.querySelectorAll('.ms-group-btn').forEach(btn =>
      btn.addEventListener('click', e => {
        const g = (e.currentTarget as HTMLElement).dataset['group'] as GroupFilter;
        if (g) { this.groupFilter = g; this.renderPanel(); }
      }),
    );
  }
}
