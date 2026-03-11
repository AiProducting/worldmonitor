import { Panel } from './Panel';
import { t } from '@/services/i18n';
import { escapeHtml } from '@/utils/sanitize';
import { MarketServiceClient } from '@/generated/client/worldmonitor/market/v1/service_client';
import type { MarketQuote } from '@/generated/client/worldmonitor/market/v1/service_client';

// Major global equity indices by region
const REGIONS: Array<{ label: string; symbols: string[] }> = [
  {
    label: 'US',
    symbols: ['SPY', 'QQQ', 'DIA', 'IWM', 'VIX'],
  },
  {
    label: 'Europe',
    symbols: ['VGK', 'EWG', 'EWU', 'EWF', 'EWI'],
  },
  {
    label: 'Asia',
    symbols: ['EWJ', 'FXI', 'EWT', 'EWY', 'INDA'],
  },
  {
    label: 'EM',
    symbols: ['EEM', 'VWO', 'EWZ', 'EZA', 'MCHI'],
  },
];

const INDEX_NAMES: Record<string, string> = {
  SPY: 'S&P 500', QQQ: 'NASDAQ 100', DIA: 'Dow Jones', IWM: 'Russell 2000', VIX: 'VIX',
  VGK: 'Europe', EWG: 'Germany', EWU: 'UK', EWF: 'France', EWI: 'Italy',
  EWJ: 'Japan', FXI: 'China', EWT: 'Taiwan', EWY: 'S. Korea', INDA: 'India',
  EEM: 'Emerg.Mkts', VWO: 'Emerg.VWO', EWZ: 'Brazil', EZA: 'S. Africa', MCHI: 'China MSCI',
};

type RegionFilter = 'All' | 'US' | 'Europe' | 'Asia' | 'EM';
type SortMode = 'default' | 'best' | 'worst';

const ALL_SYMBOLS = REGIONS.flatMap(r => r.symbols);

const marketClient = new MarketServiceClient('', { fetch: (...args) => globalThis.fetch(...args) });

function miniSpark(data: number[], width = 48, height = 16): string {
  if (!data || data.length < 2) return '';
  const min = Math.min(...data), max = Math.max(...data);
  const rng = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / rng) * (height - 2) - 1;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const up = data[data.length - 1]! >= data[0]!;
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" class="gi-spark"><polyline points="${pts}" fill="none" stroke="${up ? '#4caf50' : '#f44336'}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

export class GlobalIndicesPanel extends Panel {
  private quotes: MarketQuote[] = [];
  private loading = true;
  private error: string | null = null;
  private region: RegionFilter = 'US';
  private sort: SortMode = 'default';

  constructor() {
    super({ id: 'global-indices', title: t('panels.globalIndices'), showCount: false });
    void this.fetchData();
  }

  public async fetchData(): Promise<void> {
    this.loading = true;
    this.error = null;
    this.renderPanel();
    try {
      const resp = await marketClient.listMarketQuotes({ symbols: ALL_SYMBOLS });
      this.quotes = resp.quotes ?? [];
      this.loading = false;
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to load index data';
      this.loading = false;
    }
    if (!this.element?.isConnected) return;
    this.renderPanel();
    setTimeout(() => { if (this.element?.isConnected) void this.fetchData(); }, 5 * 60 * 1000);
  }

  private visibleQuotes(): MarketQuote[] {
    const activeSymbols = this.region === 'All'
      ? ALL_SYMBOLS
      : REGIONS.find(r => r.label === this.region)?.symbols ?? ALL_SYMBOLS;

    let list = this.quotes.filter(q => activeSymbols.includes(q.symbol));
    if (this.sort === 'best')  list = [...list].sort((a, b) => b.change - a.change);
    if (this.sort === 'worst') list = [...list].sort((a, b) => a.change - b.change);
    return list;
  }

  protected renderPanel(): void {
    if (this.loading) { this.showLoading(); return; }
    if (this.error || !this.quotes.length) { this.showError(this.error ?? 'No data'); return; }

    const visible = this.visibleQuotes();
    const advancers = visible.filter(q => q.change > 0).length;
    const decliners = visible.filter(q => q.change < 0).length;

    const regionBtns: RegionFilter[] = ['All', 'US', 'Europe', 'Asia', 'EM'];
    const sortBtns: Array<{k: SortMode; label: string}> = [
      { k: 'default', label: 'Order' }, { k: 'best', label: '▲' }, { k: 'worst', label: '▼' },
    ];

    const regionBar = regionBtns.map(r =>
      `<button class="gi-rgn-btn${this.region === r ? ' active' : ''}" data-region="${r}">${r}</button>`,
    ).join('');
    const sortBar = sortBtns.map(s =>
      `<button class="gi-sort-btn${this.sort === s.k ? ' active' : ''}" data-sort="${s.k}">${s.label}</button>`,
    ).join('');

    const rows = visible.map(q => {
      const name = INDEX_NAMES[q.symbol] ?? escapeHtml(q.display || q.name || q.symbol);
      const chgCls = q.change > 0 ? 'gi-up' : q.change < 0 ? 'gi-down' : '';
      const sign = q.change > 0 ? '+' : '';
      const price = q.price >= 1000
        ? q.price.toLocaleString(undefined, { maximumFractionDigits: 0 })
        : q.price.toFixed(2);
      return `
        <div class="gi-row">
          <div class="gi-info">
            <span class="gi-sym">${escapeHtml(q.symbol)}</span>
            <span class="gi-name">${escapeHtml(name)}</span>
          </div>
          <div class="gi-spark-wrap">${miniSpark(q.sparkline)}</div>
          <div class="gi-price-col">
            <span class="gi-price">${price}</span>
            <span class="gi-chg ${chgCls}">${sign}${q.change.toFixed(2)}%</span>
          </div>
        </div>`;
    }).join('');

    const content = `
      <div class="gi-container">
        <div class="gi-toolbar">
          <div class="gi-region-bar">${regionBar}</div>
          <div class="gi-sort-bar">${sortBar}</div>
        </div>
        <div class="gi-breadth">
          <span class="gi-bull-txt">▲ ${advancers}</span>
          <span class="gi-dim">·</span>
          <span class="gi-bear-txt">▼ ${decliners}</span>
          <span class="gi-dim">&nbsp;of ${visible.length} indices</span>
        </div>
        <div class="gi-list">${rows}</div>
      </div>`;

    this.setContent(content);

    this.element?.querySelectorAll('.gi-rgn-btn').forEach(btn =>
      btn.addEventListener('click', e => {
        const r = (e.currentTarget as HTMLElement).dataset['region'] as RegionFilter;
        if (r) { this.region = r; this.renderPanel(); }
      }),
    );
    this.element?.querySelectorAll('.gi-sort-btn').forEach(btn =>
      btn.addEventListener('click', e => {
        const s = (e.currentTarget as HTMLElement).dataset['sort'] as SortMode;
        if (s) { this.sort = s; this.renderPanel(); }
      }),
    );
  }
}
