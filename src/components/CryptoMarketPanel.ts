import { Panel } from './Panel';
import { t } from '@/services/i18n';
import { escapeHtml } from '@/utils/sanitize';
import { MarketServiceClient } from '@/generated/client/worldmonitor/market/v1/service_client';
import type { CryptoQuote } from '@/generated/client/worldmonitor/market/v1/service_client';

const CRYPTO_IDS = [
  'bitcoin', 'ethereum', 'solana', 'binancecoin', 'xrp',
  'cardano', 'avalanche-2', 'dogecoin', 'polkadot', 'chainlink',
  'uniswap', 'aave', 'sui', 'near', 'aptos',
];

const CRYPTO_ICONS: Record<string, string> = {
  bitcoin: '₿', ethereum: 'Ξ', solana: '◎', binancecoin: 'BNB', xrp: 'XRP',
  cardano: '₳', 'avalanche-2': 'AVAX', dogecoin: 'Ð', polkadot: 'DOT', chainlink: 'LINK',
  uniswap: '🦄', aave: 'AAVE', sui: 'SUI', near: 'NEAR', aptos: 'APT',
};

type SortMode = 'default' | 'gainers' | 'losers';
type ViewFilter = 'all' | 'l1' | 'defi';

const L1_IDS = ['bitcoin', 'ethereum', 'solana', 'binancecoin', 'xrp', 'cardano', 'avalanche-2', 'near', 'aptos', 'sui'];
const DEFI_IDS = ['uniswap', 'aave', 'chainlink', 'polkadot'];

const marketClient = new MarketServiceClient('', { fetch: (...args) => globalThis.fetch(...args) });

function sparkSvg(data: number[], width = 52, height = 18): string {
  if (!data || data.length < 2) return '';
  const min = Math.min(...data), max = Math.max(...data);
  const rng = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / rng) * (height - 2) - 1;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const up = data[data.length - 1]! >= data[0]!;
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" class="cmc-spark"><polyline points="${pts}" fill="none" stroke="${up ? '#4caf50' : '#f44336'}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function fmtPrice(p: number): string {
  if (p >= 1000) return `$${p.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  if (p >= 1)    return `$${p.toFixed(2)}`;
  if (p >= 0.01) return `$${p.toFixed(4)}`;
  return `$${p.toFixed(6)}`;
}

export class CryptoMarketPanel extends Panel {
  private quotes: CryptoQuote[] = [];
  private loading = true;
  private error: string | null = null;
  private sort: SortMode = 'default';
  private view: ViewFilter = 'all';

  constructor() {
    super({ id: 'crypto-market', title: t('panels.cryptoMarket'), showCount: false });
    void this.fetchData();
  }

  public async fetchData(): Promise<void> {
    this.loading = true;
    this.error = null;
    this.renderPanel();
    try {
      const resp = await marketClient.listCryptoQuotes({ ids: CRYPTO_IDS });
      this.quotes = resp.quotes ?? [];
      this.loading = false;
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to load crypto data';
      this.loading = false;
    }
    if (!this.element?.isConnected) return;
    this.renderPanel();
    setTimeout(() => { if (this.element?.isConnected) void this.fetchData(); }, 5 * 60 * 1000);
  }

  private visibleQuotes(): CryptoQuote[] {
    let list = [...this.quotes];
    if (this.view === 'l1')   list = list.filter(q => L1_IDS.includes(q.symbol?.toLowerCase() || q.name?.toLowerCase() || ''));
    if (this.view === 'defi') list = list.filter(q => DEFI_IDS.some(d => q.symbol?.toLowerCase().includes(d.slice(0, 4)) || q.name?.toLowerCase().includes(d)));
    if (this.sort === 'gainers') list.sort((a, b) => b.change - a.change);
    if (this.sort === 'losers')  list.sort((a, b) => a.change - b.change);
    return list;
  }

  protected renderPanel(): void {
    if (this.loading) { this.showLoading(); return; }
    if (this.error || !this.quotes.length) { this.showError(this.error ?? 'No crypto data'); return; }

    const visible = this.visibleQuotes();
    const gainers = visible.filter(q => q.change > 0).length;
    const losers  = visible.filter(q => q.change < 0).length;

    const viewBtns: ViewFilter[] = ['all', 'l1', 'defi'];
    const sortBtns: Array<{k: SortMode; label: string}> = [
      { k: 'default', label: 'Default' },
      { k: 'gainers', label: '▲ Best' },
      { k: 'losers',  label: '▼ Worst' },
    ];

    const vBar = viewBtns.map(v =>
      `<button class="cmc-view-btn${this.view === v ? ' active' : ''}" data-view="${v}">${v.toUpperCase()}</button>`,
    ).join('');
    const sBar = sortBtns.map(s =>
      `<button class="cmc-sort-btn${this.sort === s.k ? ' active' : ''}" data-sort="${s.k}">${s.label}</button>`,
    ).join('');

    const rows = visible.map(q => {
      const icon = CRYPTO_ICONS[q.symbol?.toLowerCase() || ''] ?? q.symbol?.slice(0, 3).toUpperCase() ?? '?';
      const chgCls = q.change > 0 ? 'cmc-up' : q.change < 0 ? 'cmc-down' : '';
      const sign = q.change > 0 ? '+' : '';
      return `
        <div class="cmc-row">
          <span class="cmc-icon">${icon.length <= 2 ? icon : `<span style="font-size:.58rem">${escapeHtml(icon)}</span>`}</span>
          <div class="cmc-info">
            <span class="cmc-sym">${escapeHtml((q.symbol || '').toUpperCase())}</span>
            <span class="cmc-name">${escapeHtml(q.name || '')}</span>
          </div>
          <div class="cmc-spark-wrap">${sparkSvg(q.sparkline)}</div>
          <div class="cmc-price-col">
            <span class="cmc-price">${fmtPrice(q.price)}</span>
            <span class="cmc-chg ${chgCls}">${sign}${q.change.toFixed(2)}%</span>
          </div>
        </div>`;
    }).join('');

    const content = `
      <div class="cmc-container">
        <div class="cmc-toolbar">
          <div class="cmc-view-bar">${vBar}</div>
          <div class="cmc-sort-bar">${sBar}</div>
        </div>
        <div class="cmc-breadth">
          <span class="cmc-bull-txt">▲ ${gainers} advancing</span>
          <span class="cmc-bear-txt">▼ ${losers} declining</span>
        </div>
        <div class="cmc-list">${rows}</div>
      </div>`;

    this.setContent(content);
    this.element?.querySelectorAll('.cmc-view-btn').forEach(btn =>
      btn.addEventListener('click', e => {
        const v = (e.currentTarget as HTMLElement).dataset['view'] as ViewFilter;
        if (v) { this.view = v; this.renderPanel(); }
      }),
    );
    this.element?.querySelectorAll('.cmc-sort-btn').forEach(btn =>
      btn.addEventListener('click', e => {
        const s = (e.currentTarget as HTMLElement).dataset['sort'] as SortMode;
        if (s) { this.sort = s; this.renderPanel(); }
      }),
    );
  }
}
