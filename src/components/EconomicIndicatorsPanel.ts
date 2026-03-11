import { Panel } from './Panel';
import { t } from '@/services/i18n';
import { escapeHtml } from '@/utils/sanitize';
import { EconomicServiceClient } from '@/generated/client/worldmonitor/economic/v1/service_client';
import type { FredObservation, FredSeries } from '@/generated/client/worldmonitor/economic/v1/service_client';

// Key economic FRED series to display
const ECON_INDICATORS: Array<{ id: string; label: string; shortLabel: string; unit: string; important: boolean }> = [
  { id: 'CPIAUCSL', label: 'CPI (YoY)', shortLabel: 'CPI', unit: '%', important: true },
  { id: 'UNRATE', label: 'Unemployment Rate', shortLabel: 'Unemployment', unit: '%', important: true },
  { id: 'PAYEMS', label: 'Nonfarm Payrolls', shortLabel: 'NFP', unit: 'K', important: true },
  { id: 'FEDFUNDS', label: 'Fed Funds Rate', shortLabel: 'Fed Funds', unit: '%', important: true },
  { id: 'T10YIE', label: '10Y Breakeven Inflation', shortLabel: 'Breakeven 10Y', unit: '%', important: false },
  { id: 'WALCL', label: 'Fed Balance Sheet', shortLabel: 'Fed Balance Sheet', unit: '$T', important: false },
  { id: 'USALOLITONOSTSAM', label: 'US Leading Indicators', shortLabel: 'LEI', unit: 'idx', important: false },
  { id: 'PCE', label: 'Personal Consumption', shortLabel: 'PCE', unit: '$B', important: false },
  { id: 'MORTGAGE30US', label: '30Y Mortgage Rate', shortLabel: 'Mortgage 30Y', unit: '%', important: false },
  { id: 'ICSA', label: 'Initial Jobless Claims', shortLabel: 'Jobless Claims', unit: 'K', important: false },
];

interface IndicatorResult {
  id: string;
  label: string;
  shortLabel: string;
  unit: string;
  important: boolean;
  latest: FredObservation | null;
  previous: FredObservation | null;
  change: number | null;
  changePct: number | null;
  series: FredSeries | null;
}

type FilterMode = 'all' | 'key';

const economicClient = new EconomicServiceClient('', { fetch: (...args) => globalThis.fetch(...args) });

function formatVal(value: number, unit: string): string {
  if (unit === '$T') return `$${(value / 1_000_000).toFixed(2)}T`;
  if (unit === '$B') return `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}B`;
  if (unit === 'K' && Math.abs(value) >= 1000) return `${(value / 1000).toFixed(0)}M`;
  if (unit === '%') return `${value.toFixed(1)}%`;
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${unit}`;
}

function miniSparkSvg(obs: FredObservation[], width = 64, height = 22): string {
  if (obs.length < 3) return '';
  const vals = obs.map(o => o.value).filter(v => v !== null && !isNaN(v));
  if (vals.length < 2) return '';
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min || 1;
  const pts = vals.map((v, i) => {
    const x = (i / (vals.length - 1)) * width;
    const y = height - ((v - min) / range) * (height - 2) - 1;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const trend = vals[vals.length - 1]! > vals[0]!;
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" class="econ-spark"><polyline points="${pts}" fill="none" stroke="${trend ? '#4caf50' : '#f44336'}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

export class EconomicIndicatorsPanel extends Panel {
  private indicators: IndicatorResult[] = [];
  private loading = true;
  private error: string | null = null;
  private filter: FilterMode = 'key';

  constructor() {
    super({ id: 'economic-indicators', title: t('panels.economicIndicators'), showCount: false });
    void this.fetchData();
  }

  public async fetchData(): Promise<void> {
    this.loading = true;
    this.error = null;
    this.renderPanel();

    try {
      const resp = await economicClient.getFredSeriesBatch({
        seriesIds: ECON_INDICATORS.map(i => i.id),
        limit: 24,
      });

      this.indicators = ECON_INDICATORS.map(ind => {
        const series = resp.results?.[ind.id] ?? null;
        const obs = series?.observations ?? [];
        const validObs = obs.filter(o => o.value !== null && !isNaN(o.value));
        const latest = validObs[validObs.length - 1] ?? null;
        const previous = validObs[validObs.length - 2] ?? null;

        let change: number | null = null;
        let changePct: number | null = null;
        if (latest && previous) {
          change = latest.value - previous.value;
          changePct = previous.value !== 0 ? (change / Math.abs(previous.value)) * 100 : null;
        }

        return { ...ind, series, latest, previous, change, changePct };
      });

      this.loading = false;
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to load indicators';
      this.loading = false;
    }

    if (!this.element?.isConnected) return;
    this.renderPanel();
    this.scheduleRefresh();
  }

  private scheduleRefresh(): void {
    setTimeout(() => {
      if (this.element?.isConnected) void this.fetchData();
    }, 20 * 60 * 1000);
  }

  protected renderPanel(): void {
    if (this.loading) {
      this.showLoading();
      return;
    }
    if (this.error) {
      this.showError(this.error);
      return;
    }

    const visible = this.filter === 'key'
      ? this.indicators.filter(i => i.important)
      : this.indicators;

    const filterBtns = (['key', 'all'] as FilterMode[]).map(f => {
      const labels: Record<FilterMode, string> = { key: 'Key', all: 'All' };
      return `<button class="ecal-filter-btn${this.filter === f ? ' active' : ''}" data-filter="${f}">${labels[f]}</button>`;
    }).join('');

    const rows = visible.map(ind => {
      if (!ind.latest) return '';
      const spark = ind.series ? miniSparkSvg(ind.series.observations.slice(-20)) : '';
      const chgCls = ind.change === null ? '' : ind.change > 0 ? 'econ-up' : ind.change < 0 ? 'econ-down' : '';
      const arrow = ind.change === null ? '' : ind.change > 0 ? '▲' : ind.change < 0 ? '▼' : '—';
      const chgStr = ind.change !== null ? `${arrow} ${Math.abs(ind.changePct ?? ind.change).toFixed(1)}${ind.changePct !== null ? '%' : ''}` : '';

      return `
        <div class="ecal-row${ind.important ? ' ecal-important' : ''}">
          <div class="ecal-label-wrap">
            <span class="ecal-label">${escapeHtml(ind.shortLabel)}</span>
            <span class="ecal-date">${escapeHtml(ind.latest.date)}</span>
          </div>
          <div class="ecal-spark">${spark}</div>
          <div class="ecal-values">
            <span class="ecal-value">${formatVal(ind.latest.value, ind.unit)}</span>
            <span class="ecal-change ${chgCls}">${escapeHtml(chgStr)}</span>
          </div>
        </div>`;
    }).filter(Boolean).join('');

    const content = `
      <div class="ecal-container">
        <div class="ecal-toolbar">
          <div class="ecal-filter-bar">${filterBtns}</div>
          <span class="ecal-subtitle">FRED · ${new Date().toLocaleDateString()}</span>
        </div>
        <div class="ecal-list">
          ${rows || '<div class="ecal-empty">No data available</div>'}
        </div>
      </div>`;

    this.setContent(content);
    this.attachFilterListeners();
  }

  private attachFilterListeners(): void {
    this.element?.querySelectorAll('.ecal-filter-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const f = (e.currentTarget as HTMLElement).dataset['filter'] as FilterMode;
        if (f) {
          this.filter = f;
          this.renderPanel();
        }
      });
    });
  }
}
