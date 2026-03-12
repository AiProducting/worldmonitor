import { Panel } from './Panel';
import { t } from '@/services/i18n';
import { escapeHtml } from '@/utils/sanitize';
import { EconomicServiceClient } from '@/generated/client/worldmonitor/economic/v1/service_client';
import type { FredSeries } from '@/generated/client/worldmonitor/economic/v1/service_client';

const econClient = new EconomicServiceClient('', { fetch: (...args) => globalThis.fetch(...args) });

// BIS Real Effective Exchange Rate (broad basket) FRED series for major currencies
interface CurrencyDef {
  id: string;       // FRED series ID (Nominal Broad Dollar Index or BIS REER)
  label: string;
  flag: string;     // emoji flag
  code: string;
}

const CURRENCIES: CurrencyDef[] = [
  { id: 'DTWEXBGS',  label: 'US Dollar',         flag: '🇺🇸', code: 'USD' },
  { id: 'DEXUSEU',   label: 'Euro',              flag: '🇪🇺', code: 'EUR' },
  { id: 'DEXJPUS',   label: 'Japanese Yen',      flag: '🇯🇵', code: 'JPY' },
  { id: 'DEXUSUK',   label: 'British Pound',     flag: '🇬🇧', code: 'GBP' },
  { id: 'DEXCAUS',   label: 'Canadian Dollar',   flag: '🇨🇦', code: 'CAD' },
  { id: 'DEXUSAL',   label: 'Australian Dollar',  flag: '🇦🇺', code: 'AUD' },
  { id: 'DEXSIUS',   label: 'Singapore Dollar',   flag: '🇸🇬', code: 'SGD' },
  { id: 'DEXSZUS',   label: 'Swiss Franc',        flag: '🇨🇭', code: 'CHF' },
];

type SortMode = 'strength' | 'name' | 'change';

interface CurrencyStrength {
  def: CurrencyDef;
  current: number | null;
  change30d: number | null;  // 30-day % change
  change90d: number | null;  // 90-day % change
  sparkline: number[];       // last 60 observations
}

function strengthColor(change: number | null): string {
  if (change == null) return '#90a4ae';
  if (change > 2) return '#2e7d32';
  if (change > 0.5) return '#66bb6a';
  if (change > -0.5) return '#ffc107';
  if (change > -2) return '#f44336';
  return '#d32f2f';
}

function miniSparkline(values: number[], color: string): string {
  if (values.length < 2) return '';
  const W = 70;
  const H = 20;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * W;
    const y = H - ((v - min) / range) * (H - 2) - 1;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
    <polyline points="${points}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round"/>
  </svg>`;
}

export class CurrencyStrengthPanel extends Panel {
  private data: CurrencyStrength[] = [];
  private loading = true;
  private error: string | null = null;
  private sortMode: SortMode = 'strength';

  constructor() {
    super({ id: 'currency-strength', title: t('panels.currencyStrength') });
    void this.fetchData();
  }

  public async fetchData(): Promise<void> {
    this.loading = true;
    this.error = null;
    this.showLoading();
    try {
      const ids = CURRENCIES.map(c => c.id);
      const res = await econClient.getFredSeriesBatch({ seriesIds: ids, limit: 120 });
      const results = res.results ?? {};

      this.data = CURRENCIES.map(def => {
        const series: FredSeries | undefined = results[def.id];
        const obs = series?.observations ?? [];
        const sorted = [...obs].sort((a, b) => b.date.localeCompare(a.date));

        const current = sorted[0]?.value ?? null;
        const val30 = sorted[21]?.value ?? null;  // ~30 trading days
        const val90 = sorted[63]?.value ?? null;  // ~90 trading days

        const change30d = current != null && val30 != null && val30 !== 0
          ? ((current - val30) / Math.abs(val30)) * 100
          : null;
        const change90d = current != null && val90 != null && val90 !== 0
          ? ((current - val90) / Math.abs(val90)) * 100
          : null;

        // For JPY and others quoted as foreign/USD, invert the strength interpretation
        const sparkline = sorted.slice(0, 60).reverse().map(o => o.value ?? 0);

        return { def, current, change30d, change90d, sparkline };
      });

      this.setCount(this.data.filter(d => d.change30d != null && d.change30d > 0).length);
      this.loading = false;
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to load currency data';
      this.loading = false;
    }
    if (this.element?.isConnected) this.renderPanel();
    setTimeout(() => { if (this.element?.isConnected) void this.fetchData(); }, 20 * 60 * 1000);
  }

  private sorted(): CurrencyStrength[] {
    const copy = [...this.data];
    switch (this.sortMode) {
      case 'strength': return copy.sort((a, b) => (b.change30d ?? 0) - (a.change30d ?? 0));
      case 'change': return copy.sort((a, b) => (b.change90d ?? 0) - (a.change90d ?? 0));
      case 'name': return copy.sort((a, b) => a.def.code.localeCompare(b.def.code));
    }
  }

  protected renderPanel(): void {
    if (this.loading) { this.showLoading(); return; }
    if (this.error) { this.showError(this.error); return; }

    const sortBtns = (['strength', 'name', 'change'] as SortMode[]).map(m => {
      const active = m === this.sortMode;
      return `<button data-sort="${m}" style="background:${active ? 'rgba(66,165,245,0.2)' : 'transparent'};border:1px solid ${active ? '#42a5f5' : 'rgba(255,255,255,0.1)'};color:${active ? '#42a5f5' : 'rgba(255,255,255,0.5)'};border-radius:4px;padding:2px 8px;font-size:10px;cursor:pointer">${m === 'strength' ? '30d' : m === 'change' ? '90d' : 'A-Z'}</button>`;
    }).join('');

    const rows = this.sorted().map(c => {
      const ch30 = c.change30d;
      const ch90 = c.change90d;
      const color30 = strengthColor(ch30);
      const color90 = strengthColor(ch90);
      const sign30 = ch30 != null && ch30 >= 0 ? '+' : '';
      const sign90 = ch90 != null && ch90 >= 0 ? '+' : '';

      // Strength bar (relative, centered at 0)
      const barVal = ch30 != null ? Math.min(Math.abs(ch30), 5) : 0;
      const barW = (barVal / 5) * 50;
      const isPos = (ch30 ?? 0) >= 0;

      return `<div style="display:flex;align-items:center;gap:6px;padding:5px 8px;border-radius:4px;margin-bottom:2px;background:rgba(255,255,255,0.02)">
        <div style="width:20px;font-size:14px">${c.def.flag}</div>
        <div style="width:36px;font-size:12px;font-weight:600;color:rgba(255,255,255,0.9)">${escapeHtml(c.def.code)}</div>
        <div style="flex:1;display:flex;align-items:center;justify-content:center">
          <div style="width:50px;height:4px;background:rgba(255,255,255,0.05);border-radius:2px;position:relative;overflow:hidden">
            <div style="position:absolute;${isPos ? 'left:50%' : `right:50%`};width:${barW}%;height:100%;background:${color30};border-radius:2px"></div>
          </div>
        </div>
        <div style="width:70px">${miniSparkline(c.sparkline, color30)}</div>
        <div style="width:48px;text-align:right;font-size:11px;font-weight:600;color:${color30}">${ch30 != null ? `${sign30}${ch30.toFixed(1)}%` : 'N/A'}</div>
        <div style="width:48px;text-align:right;font-size:11px;color:${color90}">${ch90 != null ? `${sign90}${ch90.toFixed(1)}%` : 'N/A'}</div>
      </div>`;
    }).join('');

    const html = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <div style="font-size:11px;color:rgba(255,255,255,0.5);text-transform:uppercase;letter-spacing:0.5px">Relative Strength</div>
        <div style="display:flex;gap:4px" class="cs-sort-btns">${sortBtns}</div>
      </div>
      <div style="display:flex;gap:6px;padding:0 8px 4px;font-size:10px;color:rgba(255,255,255,0.4)">
        <div style="width:20px"></div>
        <div style="width:36px">CCY</div>
        <div style="flex:1;text-align:center">Strength</div>
        <div style="width:70px;text-align:center">Trend</div>
        <div style="width:48px;text-align:right">30d</div>
        <div style="width:48px;text-align:right">90d</div>
      </div>
      ${rows}
      <div style="font-size:10px;color:rgba(255,255,255,0.35);margin-top:8px;text-align:center">
        Exchange rates via FRED • Updated every 20 min
      </div>`;

    this.setContent(html);

    // Attach sort handlers
    this.element?.querySelectorAll('[data-sort]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.sortMode = (btn as HTMLElement).dataset.sort as SortMode;
        this.renderPanel();
      });
    });
  }
}
