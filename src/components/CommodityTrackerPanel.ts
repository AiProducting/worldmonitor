import { Panel } from './Panel';
import { t } from '@/services/i18n';
import { escapeHtml } from '@/utils/sanitize';
import { MarketServiceClient } from '@/generated/client/worldmonitor/market/v1/service_client';
import type { CommodityQuote } from '@/generated/client/worldmonitor/market/v1/service_client';
import { getHydratedData } from '@/services/bootstrap';

// Metadata for known commodity symbols
const COMMODITY_META: Record<string, { icon: string; group: string; unit: string }> = {
  // Energy
  CL:     { icon: '🛢', group: 'Energy',     unit: '$/bbl' },
  BZ:     { icon: '🛢', group: 'Energy',     unit: '$/bbl' },
  NG:     { icon: '🔥', group: 'Energy',     unit: '$/MMBtu' },
  HO:     { icon: '⛽', group: 'Energy',     unit: '$/gal' },
  RB:     { icon: '⛽', group: 'Energy',     unit: '$/gal' },
  // Metals
  GC:     { icon: '🥇', group: 'Metals',     unit: '$/oz' },
  SI:     { icon: '🥈', group: 'Metals',     unit: '$/oz' },
  HG:     { icon: '🔶', group: 'Metals',     unit: '$/lb' },
  PL:     { icon: '⚪', group: 'Metals',     unit: '$/oz' },
  PA:     { icon: '⚫', group: 'Metals',     unit: '$/oz' },
  // Agriculture
  ZW:     { icon: '🌾', group: 'Agriculture', unit: '¢/bu' },
  ZC:     { icon: '🌽', group: 'Agriculture', unit: '¢/bu' },
  ZS:     { icon: '🌱', group: 'Agriculture', unit: '¢/bu' },
  KC:     { icon: '☕', group: 'Agriculture', unit: '¢/lb' },
  SB:     { icon: '🍬', group: 'Agriculture', unit: '¢/lb' },
  CC:     { icon: '🍫', group: 'Agriculture', unit: '$/MT' },
  CT:     { icon: '🧶', group: 'Agriculture', unit: '¢/lb' },
  // Softs / Livestock
  LE:     { icon: '🐄', group: 'Livestock',  unit: '¢/lb' },
  GF:     { icon: '🐮', group: 'Livestock',  unit: '¢/lb' },
  HE:     { icon: '🐷', group: 'Livestock',  unit: '¢/lb' },
};

type GroupFilter = 'All' | 'Energy' | 'Metals' | 'Agriculture' | 'Livestock';

const marketClient = new MarketServiceClient('', { fetch: (...args) => globalThis.fetch(...args) });

function sparklineSvg(data: number[], width = 56, height = 20): string {
  if (!data || data.length < 2) return '';
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / range) * (height - 2) - 1;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const trend = data[data.length - 1]! >= data[0]!;
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" class="cmd-spark"><polyline points="${pts}" fill="none" stroke="${trend ? '#4caf50' : '#f44336'}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function formatCommodityPrice(price: number, _unit: string): string {
  if (Math.abs(price) >= 1000) return price.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return price.toFixed(2);
}

export class CommodityTrackerPanel extends Panel {
  private quotes: CommodityQuote[] = [];
  private loading = true;
  private error: string | null = null;
  private group: GroupFilter = 'All';

  constructor() {
    super({ id: 'commodity-tracker', title: t('panels.commodityTracker'), showCount: false });
    void this.fetchData();
  }

  public async fetchData(): Promise<void> {
    this.loading = true;
    this.error = null;
    this.renderPanel();

    const hydrated = getHydratedData('commodityQuotes') as { quotes?: CommodityQuote[] } | undefined;
    if (hydrated?.quotes?.length) {
      this.quotes = hydrated.quotes;
      this.loading = false;
      this.renderPanel();
      this.scheduleRefresh();
      return;
    }

    try {
      const resp = await marketClient.listCommodityQuotes({ symbols: [] });
      this.quotes = resp.quotes ?? [];
      this.loading = false;
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to load commodities';
      this.loading = false;
    }

    if (!this.element?.isConnected) return;
    this.renderPanel();
    this.scheduleRefresh();
  }

  private scheduleRefresh(): void {
    setTimeout(() => {
      if (this.element?.isConnected) void this.fetchData();
    }, 3 * 60 * 1000);
  }

  private filteredQuotes(): CommodityQuote[] {
    if (this.group === 'All') return this.quotes;
    return this.quotes.filter(q => COMMODITY_META[q.symbol]?.group === this.group);
  }

  protected renderPanel(): void {
    if (this.loading) { this.showLoading(); return; }
    if (this.error || !this.quotes.length) { this.showError(this.error ?? 'No data'); return; }

    const visible = this.filteredQuotes();
    const groups: GroupFilter[] = ['All', 'Energy', 'Metals', 'Agriculture', 'Livestock'];

    const groupBtns = groups.map(g => {
      const count = g === 'All' ? this.quotes.length : this.quotes.filter(q => COMMODITY_META[q.symbol]?.group === g).length;
      if (count === 0 && g !== 'All') return '';
      return `<button class="cmd-grp-btn${this.group === g ? ' active' : ''}" data-group="${g}">${g}${g !== 'All' ? ` <span class="cmd-grp-count">${count}</span>` : ''}</button>`;
    }).filter(Boolean).join('');

    const advancing = visible.filter(q => q.change > 0).length;
    const declining = visible.filter(q => q.change < 0).length;

    const rows = visible.map(q => {
      const meta = COMMODITY_META[q.symbol];
      const icon = meta?.icon ?? '📦';
      const unit = meta?.unit ?? '';
      const chgCls = q.change > 0 ? 'cmd-up' : q.change < 0 ? 'cmd-down' : 'cmd-flat';
      const sign = q.change > 0 ? '+' : '';
      return `
        <div class="cmd-row">
          <span class="cmd-icon">${icon}</span>
          <div class="cmd-info">
            <span class="cmd-sym">${escapeHtml(q.symbol)}</span>
            <span class="cmd-name">${escapeHtml(q.display || q.name)}</span>
          </div>
          <div class="cmd-spark-wrap">${sparklineSvg(q.sparkline)}</div>
          <div class="cmd-price-col">
            <span class="cmd-price">${formatCommodityPrice(q.price, unit)}</span>
            <span class="cmd-chg ${chgCls}">${sign}${q.change.toFixed(2)}%</span>
          </div>
        </div>`;
    }).join('');

    const content = `
      <div class="cmd-container">
        <div class="cmd-toolbar">${groupBtns}</div>
        <div class="cmd-breadth">
          <span class="cmd-up">▲ ${advancing}</span>
          <span class="cmd-flat">— ${visible.length - advancing - declining}</span>
          <span class="cmd-down">▼ ${declining}</span>
        </div>
        <div class="cmd-list">${rows}</div>
        <div class="yc-footer">Commodities Futures · ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
      </div>`;

    this.setContent(content);
    this.attachGroupListeners();
  }

  private attachGroupListeners(): void {
    this.element?.querySelectorAll('.cmd-grp-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const g = (e.currentTarget as HTMLElement).dataset['group'] as GroupFilter;
        if (g) { this.group = g; this.renderPanel(); }
      });
    });
  }
}
