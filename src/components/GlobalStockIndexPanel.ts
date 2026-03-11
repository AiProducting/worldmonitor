import { Panel } from './Panel';
import { t } from '@/services/i18n';
import { escapeHtml } from '@/utils/sanitize';
import { MarketServiceClient } from '@/generated/client/worldmonitor/market/v1/service_client';

// Country list for stock index lookup
const COUNTRIES: Array<{ code: string; name: string; flag: string; region: string }> = [
  { code: 'US', name: 'United States',   flag: '🇺🇸', region: 'Americas' },
  { code: 'GB', name: 'United Kingdom',  flag: '🇬🇧', region: 'Europe' },
  { code: 'DE', name: 'Germany',         flag: '🇩🇪', region: 'Europe' },
  { code: 'FR', name: 'France',          flag: '🇫🇷', region: 'Europe' },
  { code: 'JP', name: 'Japan',           flag: '🇯🇵', region: 'Asia' },
  { code: 'CN', name: 'China',           flag: '🇨🇳', region: 'Asia' },
  { code: 'IN', name: 'India',           flag: '🇮🇳', region: 'Asia' },
  { code: 'KR', name: 'South Korea',     flag: '🇰🇷', region: 'Asia' },
  { code: 'TW', name: 'Taiwan',          flag: '🇹🇼', region: 'Asia' },
  { code: 'AU', name: 'Australia',       flag: '🇦🇺', region: 'Asia' },
  { code: 'SG', name: 'Singapore',       flag: '🇸🇬', region: 'Asia' },
  { code: 'HK', name: 'Hong Kong',       flag: '🇭🇰', region: 'Asia' },
  { code: 'BR', name: 'Brazil',          flag: '🇧🇷', region: 'Americas' },
  { code: 'CA', name: 'Canada',          flag: '🇨🇦', region: 'Americas' },
  { code: 'MX', name: 'Mexico',          flag: '🇲🇽', region: 'Americas' },
  { code: 'IT', name: 'Italy',           flag: '🇮🇹', region: 'Europe' },
  { code: 'ES', name: 'Spain',           flag: '🇪🇸', region: 'Europe' },
  { code: 'CH', name: 'Switzerland',     flag: '🇨🇭', region: 'Europe' },
  { code: 'SE', name: 'Sweden',          flag: '🇸🇪', region: 'Europe' },
  { code: 'NL', name: 'Netherlands',     flag: '🇳🇱', region: 'Europe' },
  { code: 'SA', name: 'Saudi Arabia',    flag: '🇸🇦', region: 'MiddleEast' },
  { code: 'AE', name: 'UAE',             flag: '🇦🇪', region: 'MiddleEast' },
  { code: 'ZA', name: 'South Africa',    flag: '🇿🇦', region: 'Africa' },
  { code: 'NG', name: 'Nigeria',         flag: '🇳🇬', region: 'Africa' },
  { code: 'PL', name: 'Poland',          flag: '🇵🇱', region: 'Europe' },
];

type RegionFilter = 'All' | 'Americas' | 'Europe' | 'Asia' | 'MiddleEast' | 'Africa';
type SortMode = 'default' | 'best' | 'worst';

interface IndexResult {
  code: string;
  name: string;
  flag: string;
  region: string;
  indexName: string;
  symbol: string;
  price: number;
  change: number;
  currency: string;
  available: boolean;
}

const marketClient = new MarketServiceClient('', { fetch: (...args) => globalThis.fetch(...args) });

export class GlobalStockIndexPanel extends Panel {
  private results: IndexResult[] = [];
  private loading = true;
  private error: string | null = null;
  private region: RegionFilter = 'All';
  private sort: SortMode = 'default';
  private fetched = false;

  constructor() {
    super({ id: 'global-stock-index', title: t('panels.globalStockIndex'), showCount: false });
    void this.fetchData();
  }

  public async fetchData(): Promise<void> {
    this.loading = true;
    this.error = null;
    this.renderPanel();

    try {
      // Fetch all countries in parallel with individual calls
      const requests = COUNTRIES.map(async c => {
        try {
          const resp = await marketClient.getCountryStockIndex({ countryCode: c.code });
          return {
            code: c.code,
            name: c.name,
            flag: c.flag,
            region: c.region,
            indexName: resp.indexName,
            symbol: resp.symbol,
            price: resp.price,
            change: resp.weekChangePercent,
            currency: resp.currency,
            available: resp.available,
          } as IndexResult;
        } catch {
          return {
            code: c.code,
            name: c.name,
            flag: c.flag,
            region: c.region,
            indexName: '',
            symbol: '',
            price: 0,
            change: 0,
            currency: '',
            available: false,
          } as IndexResult;
        }
      });

      this.results = (await Promise.all(requests)).filter(r => r.available);
      this.fetched = true;
      this.loading = false;
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to load stock indices';
      this.loading = false;
    }

    if (!this.element?.isConnected) return;
    this.renderPanel();
    setTimeout(() => { if (this.element?.isConnected) void this.fetchData(); }, 10 * 60 * 1000);
  }

  private visibleResults(): IndexResult[] {
    let list = this.region === 'All'
      ? [...this.results]
      : this.results.filter(r => r.region === this.region);

    if (this.sort === 'best')  list.sort((a, b) => b.change - a.change);
    if (this.sort === 'worst') list.sort((a, b) => a.change - b.change);
    return list;
  }

  protected renderPanel(): void {
    if (this.loading) { this.showLoading(); return; }
    if (this.error || (!this.results.length && this.fetched)) { this.showError(this.error ?? 'No data available'); return; }

    const visible = this.visibleResults();
    const advancers  = visible.filter(r => r.change > 0).length;
    const decliners  = visible.filter(r => r.change < 0).length;
    const avgChange = visible.length > 0
      ? visible.reduce((s, r) => s + r.change, 0) / visible.length
      : 0;

    const regions: RegionFilter[] = ['All', 'Americas', 'Europe', 'Asia', 'MiddleEast', 'Africa'];
    const regionBtns = regions.map(r =>
      `<button class="gsi-rgn-btn${this.region === r ? ' active' : ''}" data-region="${r}">${r === 'MiddleEast' ? 'M.East' : r}</button>`,
    ).join('');

    const sortBtns: Array<{k: SortMode; label: string}> = [
      { k: 'default', label: 'Order' }, { k: 'best', label: '▲' }, { k: 'worst', label: '▼' },
    ];
    const sBtns = sortBtns.map(s =>
      `<button class="gsi-sort-btn${this.sort === s.k ? ' active' : ''}" data-sort="${s.k}">${s.label}</button>`,
    ).join('');

    const avgColor = avgChange > 0 ? '#4caf50' : avgChange < 0 ? '#f44336' : '#90a4ae';
    const rows = visible.map(r => {
      const chgCls = r.change > 0 ? 'gsi-up' : r.change < 0 ? 'gsi-down' : '';
      const sign = r.change > 0 ? '+' : '';
      const price = r.price >= 10000 ? r.price.toLocaleString(undefined, { maximumFractionDigits: 0 }) : r.price.toFixed(2);
      return `
        <div class="gsi-row">
          <span class="gsi-flag">${r.flag}</span>
          <div class="gsi-info">
            <span class="gsi-name">${escapeHtml(r.indexName || r.name)}</span>
            <span class="gsi-code">${escapeHtml(r.code)} · ${escapeHtml(r.symbol)}</span>
          </div>
          <div class="gsi-price-col">
            <span class="gsi-price">${price} <span class="gsi-ccy">${escapeHtml(r.currency)}</span></span>
            <span class="gsi-chg ${chgCls}">${sign}${r.change.toFixed(2)}% <span class="gsi-period">1W</span></span>
          </div>
        </div>`;
    }).join('');

    const content = `
      <div class="gsi-container">
        <div class="gsi-toolbar">
          <div class="gsi-region-bar">${regionBtns}</div>
          <div class="gsi-sort-bar">${sBtns}</div>
        </div>
        <div class="gsi-summary">
          <span class="gsi-bull">▲ ${advancers}</span>
          <span class="gsi-dim">·</span>
          <span class="gsi-bear">▼ ${decliners}</span>
          <span class="gsi-dim">&nbsp;· avg</span>
          <span style="color:${avgColor};font-weight:700">${avgChange >= 0 ? '+' : ''}${avgChange.toFixed(2)}%</span>
        </div>
        <div class="gsi-list">${rows}</div>
        <div class="yc-footer">Country Stock Indices · 1W change</div>
      </div>`;

    this.setContent(content);

    this.element?.querySelectorAll('.gsi-rgn-btn').forEach(btn =>
      btn.addEventListener('click', e => {
        const r = (e.currentTarget as HTMLElement).dataset['region'] as RegionFilter;
        if (r) { this.region = r; this.renderPanel(); }
      }),
    );
    this.element?.querySelectorAll('.gsi-sort-btn').forEach(btn =>
      btn.addEventListener('click', e => {
        const s = (e.currentTarget as HTMLElement).dataset['sort'] as SortMode;
        if (s) { this.sort = s; this.renderPanel(); }
      }),
    );
  }
}
