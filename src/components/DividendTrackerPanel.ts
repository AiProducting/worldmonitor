import { Panel } from './Panel';
import { t } from '@/services/i18n';
import { escapeHtml } from '@/utils/sanitize';
import { EconomicServiceClient } from '@/generated/client/worldmonitor/economic/v1/service_client';
import type { FredSeries } from '@/generated/client/worldmonitor/economic/v1/service_client';

const econClient = new EconomicServiceClient('', { fetch: (...args) => globalThis.fetch(...args) });

// Dividend yield proxies via FRED
interface DividendIndex {
  id: string;
  label: string;
  description: string;
  category: 'equity' | 'bond' | 'real-estate';
}

const INDICES: DividendIndex[] = [
  // Equity dividend yields
  { id: 'MULTPL/SP500_DIV_YIELD_MONTH', label: 'S&P 500 Dividend Yield', description: 'Trailing 12m dividend yield', category: 'equity' },
  // We use FRED bond yields as proxies / comparisons
  { id: 'DGS10',    label: '10Y Treasury Yield',     description: 'Risk-free benchmark',     category: 'bond' },
  { id: 'DGS2',     label: '2Y Treasury Yield',      description: 'Short-term safe yield',   category: 'bond' },
  { id: 'DGS30',    label: '30Y Treasury Yield',     description: 'Long bond yield',          category: 'bond' },
  { id: 'BAA',      label: 'Baa Corporate Yield',    description: 'Investment grade corporates', category: 'bond' },
  { id: 'AAA',      label: 'Aaa Corporate Yield',    description: 'Highest grade corporates', category: 'bond' },
  { id: 'MORTGAGE30US', label: '30Y Mortgage Rate',   description: 'Housing yield benchmark', category: 'real-estate' },
  { id: 'TEDRATE',  label: 'TED Spread',             description: 'Interbank risk premium',  category: 'bond' },
];

// We'll actually only fetch the yields that exist in FRED
const FRED_IDS = INDICES.filter(i => !i.id.includes('/')).map(i => i.id);

const CAT_COLORS: Record<DividendIndex['category'], string> = {
  equity: '#66bb6a',
  bond: '#42a5f5',
  'real-estate': '#ff9800',
};

type ViewMode = 'yields' | 'spread';

export class DividendTrackerPanel extends Panel {
  private data = new Map<string, FredSeries>();
  private loading = true;
  private error: string | null = null;
  private viewMode: ViewMode = 'yields';

  constructor() {
    super({ id: 'dividend-tracker', title: t('panels.dividendTracker') });
    void this.fetchData();
  }

  public async fetchData(): Promise<void> {
    this.loading = true;
    this.error = null;
    this.showLoading();
    try {
      const res = await econClient.getFredSeriesBatch({ seriesIds: FRED_IDS, limit: 60 });
      for (const [id, series] of Object.entries(res.results ?? {})) {
        this.data.set(id, series);
      }
      this.loading = false;
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to load yield data';
      this.loading = false;
    }
    if (this.element?.isConnected) this.renderPanel();
    setTimeout(() => { if (this.element?.isConnected) void this.fetchData(); }, 20 * 60 * 1000);
  }

  private latest(id: string): number | null {
    const s = this.data.get(id);
    if (!s?.observations?.length) return null;
    const sorted = [...s.observations].sort((a, b) => b.date.localeCompare(a.date));
    return sorted[0]?.value ?? null;
  }

  private change(id: string, offsetDays: number): number | null {
    const s = this.data.get(id);
    if (!s?.observations?.length) return null;
    const sorted = [...s.observations].sort((a, b) => b.date.localeCompare(a.date));
    const curr = sorted[0]?.value;
    const prev = sorted[Math.min(offsetDays, sorted.length - 1)]?.value;
    if (curr == null || prev == null) return null;
    return curr - prev;
  }

  private sparkline(id: string): number[] {
    const s = this.data.get(id);
    if (!s?.observations?.length) return [];
    const sorted = [...s.observations].sort((a, b) => b.date.localeCompare(a.date));
    return sorted.slice(0, 30).reverse().map(o => o.value ?? 0);
  }

  private renderSparkSvg(values: number[], color: string): string {
    if (values.length < 2) return '';
    const W = 60; const H = 16;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const pts = values.map((v, i) => {
      const x = (i / (values.length - 1)) * W;
      const y = H - ((v - min) / range) * (H - 2) - 1;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.5"/></svg>`;
  }

  protected renderPanel(): void {
    if (this.loading) { this.showLoading(); return; }
    if (this.error) { this.showError(this.error); return; }

    const viewBtns = (['yields', 'spread'] as ViewMode[]).map(m => {
      const active = m === this.viewMode;
      return `<button data-view="${m}" style="background:${active ? 'rgba(66,165,245,0.2)' : 'transparent'};border:1px solid ${active ? '#42a5f5' : 'rgba(255,255,255,0.1)'};color:${active ? '#42a5f5' : 'rgba(255,255,255,0.5)'};border-radius:4px;padding:2px 8px;font-size:10px;cursor:pointer">${m === 'yields' ? 'Yields' : 'Spreads'}</button>`;
    }).join('');

    let body: string;

    if (this.viewMode === 'yields') {
      const rows = INDICES.filter(i => !i.id.includes('/')).map(idx => {
        const val = this.latest(idx.id);
        const ch = this.change(idx.id, 21); // ~1 month
        const color = CAT_COLORS[idx.category];
        const spark = this.sparkline(idx.id);
        const chColor = ch != null && ch > 0 ? '#f44336' : ch != null && ch < 0 ? '#66bb6a' : '#90a4ae';
        const chSign = ch != null && ch >= 0 ? '+' : '';

        return `<div style="display:flex;align-items:center;gap:6px;padding:5px 8px;border-radius:4px;margin-bottom:2px;background:rgba(255,255,255,0.02)">
          <div style="width:4px;height:24px;border-radius:2px;background:${color}"></div>
          <div style="flex:1;min-width:0">
            <div style="font-size:12px;color:rgba(255,255,255,0.85)">${escapeHtml(idx.label)}</div>
            <div style="font-size:10px;color:rgba(255,255,255,0.4)">${escapeHtml(idx.description)}</div>
          </div>
          <div style="width:60px">${this.renderSparkSvg(spark, color)}</div>
          <div style="width:44px;text-align:right;font-size:13px;font-weight:600;color:rgba(255,255,255,0.9)">${val != null ? val.toFixed(2) + '%' : 'N/A'}</div>
          <div style="width:44px;text-align:right;font-size:11px;color:${chColor}">${ch != null ? `${chSign}${ch.toFixed(2)}` : '—'}</div>
        </div>`;
      }).join('');

      body = rows;
    } else {
      // Spread view: key yield spreads
      const spreads = [
        { name: '10Y - 2Y (Yield Curve)', a: 'DGS10', b: 'DGS2' },
        { name: 'Baa - 10Y (Credit Spread)', a: 'BAA', b: 'DGS10' },
        { name: 'Aaa - 10Y (Quality Spread)', a: 'AAA', b: 'DGS10' },
        { name: '30Y - 10Y (Term Premium)', a: 'DGS30', b: 'DGS10' },
        { name: 'Mortgage - 10Y (Housing)', a: 'MORTGAGE30US', b: 'DGS10' },
        { name: 'Baa - Aaa (Default Risk)', a: 'BAA', b: 'AAA' },
      ];

      body = spreads.map(sp => {
        const va = this.latest(sp.a);
        const vb = this.latest(sp.b);
        const spread = va != null && vb != null ? va - vb : null;
        const color = spread != null ? (spread < 0 ? '#f44336' : spread < 1 ? '#ffc107' : '#66bb6a') : '#90a4ae';
        const inverted = spread != null && spread < 0;

        return `<div style="display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:4px;margin-bottom:3px;background:${inverted ? 'rgba(244,67,54,0.08)' : 'rgba(255,255,255,0.02)'}">
          <div style="flex:1;font-size:12px;color:rgba(255,255,255,0.85)">${escapeHtml(sp.name)}</div>
          <div style="font-size:14px;font-weight:700;color:${color}">${spread != null ? spread.toFixed(2) + '%' : 'N/A'}</div>
          ${inverted ? '<div style="font-size:10px;color:#f44336;font-weight:600">⚠ INVERTED</div>' : ''}
        </div>`;
      }).join('');
    }

    const html = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <div style="font-size:11px;color:rgba(255,255,255,0.5);text-transform:uppercase;letter-spacing:0.5px">Yield & Income Monitor</div>
        <div style="display:flex;gap:4px" class="dt-view-btns">${viewBtns}</div>
      </div>
      ${body}
      <div style="font-size:10px;color:rgba(255,255,255,0.35);margin-top:8px;text-align:center">
        Yield data via FRED • Updated every 20 min
      </div>`;

    this.setContent(html);

    this.element?.querySelectorAll('[data-view]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.viewMode = (btn as HTMLElement).dataset.view as ViewMode;
        this.renderPanel();
      });
    });
  }
}
