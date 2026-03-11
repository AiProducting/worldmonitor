import { Panel } from './Panel';
import { t } from '@/services/i18n';
import { escapeHtml } from '@/utils/sanitize';
import { EconomicServiceClient } from '@/generated/client/worldmonitor/economic/v1/service_client';
import type { FredSeries } from '@/generated/client/worldmonitor/economic/v1/service_client';

// FRED FX series: quoted as units of foreign currency per USD or USD per foreign
// We normalise to "USD per 1 unit of foreign" for display
const FX_PAIRS: Array<{
  fredId: string;
  base: string;
  quote: string;
  flag: string;
  invertRate: boolean;   // if true, pair is quoted as foreign per USD — invert to get USD/foreign
  label: string;
}> = [
  { fredId: 'DEXUSEU', base: 'EUR', quote: 'USD', flag: '🇪🇺', invertRate: false, label: 'EUR/USD' },
  { fredId: 'DEXJPUS', base: 'USD', quote: 'JPY', flag: '🇯🇵', invertRate: false, label: 'USD/JPY' },
  { fredId: 'DEXUSUK', base: 'GBP', quote: 'USD', flag: '🇬🇧', invertRate: false, label: 'GBP/USD' },
  { fredId: 'DEXCHUS', base: 'USD', quote: 'CNY', flag: '🇨🇳', invertRate: false, label: 'USD/CNY' },
  { fredId: 'DEXCAUS', base: 'USD', quote: 'CAD', flag: '🇨🇦', invertRate: false, label: 'USD/CAD' },
  { fredId: 'DEXUSAL', base: 'USD', quote: 'AUD', flag: '🇦🇺', invertRate: false, label: 'AUD/USD' },
  { fredId: 'DEXSFUS', base: 'CHF', quote: 'USD', flag: '🇨🇭', invertRate: false, label: 'USD/CHF' },
  { fredId: 'DEXMXUS', base: 'USD', quote: 'MXN', flag: '🇲🇽', invertRate: false, label: 'USD/MXN' },
  { fredId: 'DEXBZUS', base: 'USD', quote: 'BRL', flag: '🇧🇷', invertRate: false, label: 'USD/BRL' },
  { fredId: 'DEXKOUS', base: 'USD', quote: 'KRW', flag: '🇰🇷', invertRate: false, label: 'USD/KRW' },
  { fredId: 'DEXINUS', base: 'USD', quote: 'INR', flag: '🇮🇳', invertRate: false, label: 'USD/INR' },
  { fredId: 'DEXHKUS', base: 'USD', quote: 'HKD', flag: '🇭🇰', invertRate: false, label: 'USD/HKD' },
];

// Batch into chunks of 10 (API limit)
const BATCH1 = FX_PAIRS.slice(0, 10).map(p => p.fredId);
const BATCH2 = FX_PAIRS.slice(10).map(p => p.fredId);

interface FxRate {
  label: string;
  base: string;
  quote: string;
  flag: string;
  rate: number | null;
  prevRate: number | null;
  change: number | null; // pct
  series: FredSeries | null;
}

type RegionFilter = 'G10' | 'EM' | 'All';

const G10_LABELS = ['EUR/USD', 'USD/JPY', 'GBP/USD', 'USD/CAD', 'AUD/USD', 'USD/CHF'];
const EM_LABELS  = ['USD/CNY', 'USD/MXN', 'USD/BRL', 'USD/KRW', 'USD/INR', 'USD/HKD'];

const economicClient = new EconomicServiceClient('', { fetch: (...args) => globalThis.fetch(...args) });

function latestTwo(series: FredSeries | null | undefined): [number | null, number | null] {
  const obs = series?.observations ?? [];
  const valid = obs.filter(o => o.value !== null && !isNaN(o.value));
  const latest = valid[valid.length - 1]?.value ?? null;
  const prev   = valid[valid.length - 2]?.value ?? null;
  return [latest, prev];
}

function microSpark(series: FredSeries | null, width = 52, height = 18): string {
  const obs = series?.observations ?? [];
  const vals = obs.map(o => o.value).filter(v => v !== null && !isNaN(v));
  if (vals.length < 2) return '';
  const min = Math.min(...vals), max = Math.max(...vals);
  const rng = max - min || 1;
  const pts = vals.map((v, i) => {
    const x = (i / (vals.length - 1)) * width;
    const y = height - ((v - min) / rng) * (height - 2) - 1;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const up = vals[vals.length - 1]! >= vals[0]!;
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" class="fx-spark"><polyline points="${pts}" fill="none" stroke="${up ? '#4caf50' : '#f44336'}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function fmtRate(rate: number | null, label: string): string {
  if (rate === null) return 'N/A';
  // Pairs with large values like JPY, KRW, CNY, INR, HKD
  const bigPairs = ['USD/JPY', 'USD/KRW', 'USD/INR', 'USD/HKD', 'USD/CNY', 'USD/MXN', 'USD/BRL'];
  if (bigPairs.includes(label)) return rate.toFixed(2);
  return rate.toFixed(4);
}

export class ForexDashboardPanel extends Panel {
  private rates: FxRate[] = [];
  private loading = true;
  private error: string | null = null;
  private region: RegionFilter = 'G10';

  constructor() {
    super({ id: 'forex-dashboard', title: t('panels.forexDashboard'), showCount: false });
    void this.fetchData();
  }

  public async fetchData(): Promise<void> {
    this.loading = true;
    this.error = null;
    this.renderPanel();

    try {
      // Fetch in two batches (max 10 per call)
      const [resp1, resp2] = await Promise.all([
        economicClient.getFredSeriesBatch({ seriesIds: BATCH1, limit: 10 }),
        BATCH2.length > 0 ? economicClient.getFredSeriesBatch({ seriesIds: BATCH2, limit: 10 }) : Promise.resolve({ results: {}, fetched: 0, requested: 0 }),
      ]);

      const allResults: Record<string, FredSeries | undefined> = { ...resp1.results, ...resp2.results };

      this.rates = FX_PAIRS.map(p => {
        const series = allResults[p.fredId] ?? null;
        const [latest, prev] = latestTwo(series);
        const change = latest !== null && prev !== null && prev !== 0
          ? ((latest - prev) / Math.abs(prev)) * 100
          : null;
        return {
          label: p.label,
          base: p.base,
          quote: p.quote,
          flag: p.flag,
          rate: latest,
          prevRate: prev,
          change,
          series,
        };
      });

      this.loading = false;
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to load FX rates';
      this.loading = false;
    }

    if (!this.element?.isConnected) return;
    this.renderPanel();
    this.scheduleRefresh();
  }

  private scheduleRefresh(): void {
    setTimeout(() => {
      if (this.element?.isConnected) void this.fetchData();
    }, 10 * 60 * 1000); // FRED FX daily, refresh every 10 min for freshness
  }

  private visibleRates(): FxRate[] {
    if (this.region === 'G10') return this.rates.filter(r => G10_LABELS.includes(r.label));
    if (this.region === 'EM')  return this.rates.filter(r => EM_LABELS.includes(r.label));
    return this.rates;
  }

  protected renderPanel(): void {
    if (this.loading) { this.showLoading(); return; }
    if (this.error || !this.rates.length) { this.showError(this.error ?? 'No data'); return; }

    const visible = this.visibleRates();
    const regions: RegionFilter[] = ['G10', 'EM', 'All'];

    const regionBtns = regions.map(r =>
      `<button class="fx-rgn-btn${this.region === r ? ' active' : ''}" data-region="${r}">${r}</button>`,
    ).join('');

    const usdStrengthCount = visible.filter(r => {
      // USD strengthening = USD/X rate up (X gets cheaper vs USD), or X/USD rate down
      if (r.label.startsWith('USD/')) return (r.change ?? 0) > 0;
      return (r.change ?? 0) < 0;
    }).length;

    const dxyDesc = usdStrengthCount >= Math.ceil(visible.length * 0.6)
      ? '<span class="fx-usd-strong">USD Strengthening ▲</span>'
      : usdStrengthCount <= Math.floor(visible.length * 0.4)
        ? '<span class="fx-usd-weak">USD Weakening ▼</span>'
        : '<span class="fx-usd-neutral">USD Mixed</span>';

    const rows = visible.map(r => {
      const chgCls = r.change === null ? '' : r.change > 0 ? 'fx-up' : r.change < 0 ? 'fx-down' : '';
      const sign = r.change !== null && r.change > 0 ? '+' : '';
      return `
        <div class="fx-row">
          <span class="fx-flag">${r.flag}</span>
          <div class="fx-pair-info">
            <span class="fx-pair-label">${escapeHtml(r.label)}</span>
            <span class="fx-pair-sub">${escapeHtml(r.base)}/${escapeHtml(r.quote)}</span>
          </div>
          <div class="fx-spark-wrap">${microSpark(r.series)}</div>
          <div class="fx-rate-col">
            <span class="fx-rate">${fmtRate(r.rate, r.label)}</span>
            <span class="fx-chg ${chgCls}">${r.change !== null ? sign + r.change.toFixed(3) + '%' : '—'}</span>
          </div>
        </div>`;
    }).join('');

    const content = `
      <div class="fx-container">
        <div class="fx-toolbar">
          <div class="fx-region-bar">${regionBtns}</div>
          ${dxyDesc}
        </div>
        <div class="fx-list">${rows}</div>
        <div class="yc-footer">FRED FX Rates (daily) · ${new Date().toLocaleDateString()}</div>
      </div>`;

    this.setContent(content);
    this.attachRegionListeners();
  }

  private attachRegionListeners(): void {
    this.element?.querySelectorAll('.fx-rgn-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const r = (e.currentTarget as HTMLElement).dataset['region'] as RegionFilter;
        if (r) { this.region = r; this.renderPanel(); }
      });
    });
  }
}
