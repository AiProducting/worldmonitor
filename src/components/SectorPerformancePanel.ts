import { Panel } from './Panel';
import { t } from '@/services/i18n';
import { escapeHtml } from '@/utils/sanitize';
import { MarketServiceClient } from '@/generated/client/worldmonitor/market/v1/service_client';
import type { SectorPerformance } from '@/generated/client/worldmonitor/market/v1/service_client';

// Sector ETF metadata for richer display
const SECTOR_META: Record<string, { icon: string; fullName: string }> = {
  XLC:  { icon: '📡', fullName: 'Communication Services' },
  XLY:  { icon: '🛍', fullName: 'Consumer Discretionary' },
  XLP:  { icon: '🛒', fullName: 'Consumer Staples' },
  XLE:  { icon: '⛽', fullName: 'Energy' },
  XLF:  { icon: '🏦', fullName: 'Financials' },
  XLV:  { icon: '⚕', fullName: 'Health Care' },
  XLI:  { icon: '🏭', fullName: 'Industrials' },
  XLB:  { icon: '⚗', fullName: 'Materials' },
  XLRE: { icon: '🏠', fullName: 'Real Estate' },
  XLK:  { icon: '💻', fullName: 'Technology' },
  XLU:  { icon: '💡', fullName: 'Utilities' },
  VNQ:  { icon: '🏢', fullName: 'Real Estate (VNQ)' },
};

type SortMode = 'default' | 'best' | 'worst';
type PeriodMode = '1D' | '1W' | '1M';

const marketClient = new MarketServiceClient('', { fetch: (...args) => globalThis.fetch(...args) });

function changeColor(v: number): string {
  if (v >= 2) return '#4caf50';
  if (v >= 0.5) return '#8bc34a';
  if (v >= 0) return '#cddc39';
  if (v >= -0.5) return '#ffeb3b';
  if (v >= -2) return '#ff9800';
  return '#f44336';
}

function heatBg(v: number): string {
  const c = changeColor(v);
  const alpha = Math.min(0.35, Math.abs(v) / 5 * 0.35 + 0.06);
  // return hex with alpha as rgba
  return `rgba(${hexToRgb(c)},${alpha})`;
}

function hexToRgb(hex: string): string {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return '255,255,255';
  return `${parseInt(result[1]!, 16)},${parseInt(result[2]!, 16)},${parseInt(result[3]!, 16)}`;
}

function breadthBar(sectors: SectorPerformance[]): string {
  const bull = sectors.filter(s => s.change > 0).length;
  const bear = sectors.filter(s => s.change < 0).length;
  const neutral = sectors.length - bull - bear;
  const total = sectors.length || 1;
  return `
    <div class="sp-breadth">
      <span class="sp-breadth-label">Breadth</span>
      <div class="sp-breadth-bar">
        <div class="sp-breadth-bull" style="width:${(bull/total*100).toFixed(1)}%" title="${bull} advancing"></div>
        <div class="sp-breadth-neut" style="width:${(neutral/total*100).toFixed(1)}%" title="${neutral} flat"></div>
        <div class="sp-breadth-bear" style="width:${(bear/total*100).toFixed(1)}%" title="${bear} declining"></div>
      </div>
      <span class="sp-breadth-counts"><span class="sp-bull-txt">${bull}↑</span> <span class="sp-bear-txt">${bear}↓</span></span>
    </div>`;
}

export class SectorPerformancePanel extends Panel {
  private sectors: SectorPerformance[] = [];
  private loading = true;
  private error: string | null = null;
  private sort: SortMode = 'default';
  private period: PeriodMode = '1D';

  constructor() {
    super({ id: 'sector-performance', title: t('panels.sectorPerformance'), showCount: false });
    void this.fetchData();
  }

  public async fetchData(): Promise<void> {
    this.loading = true;
    this.error = null;
    this.renderPanel();

    try {
      const resp = await marketClient.getSectorSummary({ period: this.period });
      this.sectors = resp.sectors ?? [];
      this.loading = false;
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to load sector data';
      this.loading = false;
    }

    if (!this.element?.isConnected) return;
    this.renderPanel();
    this.scheduleRefresh();
  }

  private scheduleRefresh(): void {
    setTimeout(() => {
      if (this.element?.isConnected) void this.fetchData();
    }, 5 * 60 * 1000);
  }

  private sortedSectors(): SectorPerformance[] {
    const s = [...this.sectors];
    if (this.sort === 'best') return s.sort((a, b) => b.change - a.change);
    if (this.sort === 'worst') return s.sort((a, b) => a.change - b.change);
    return s;
  }

  protected renderPanel(): void {
    if (this.loading) { this.showLoading(); return; }
    if (this.error || !this.sectors.length) { this.showError(this.error ?? 'No data'); return; }

    const sectors = this.sortedSectors();
    const maxAbs = Math.max(...sectors.map(s => Math.abs(s.change)), 0.1);

    const periodBtns = (['1D', '1W', '1M'] as PeriodMode[]).map(p =>
      `<button class="sp-period-btn${this.period === p ? ' active' : ''}" data-period="${p}">${p}</button>`,
    ).join('');

    const sortBtns = (['default', 'best', 'worst'] as SortMode[]).map(m => {
      const labels: Record<SortMode, string> = { default: 'Default', best: 'Best', worst: 'Worst' };
      return `<button class="sp-sort-btn${this.sort === m ? ' active' : ''}" data-sort="${m}">${labels[m]}</button>`;
    }).join('');

    const grid = sectors.map(s => {
      const meta = SECTOR_META[s.symbol];
      const label = meta?.fullName ?? s.name ?? s.symbol;
      const icon = meta?.icon ?? '📊';
      const sign = s.change >= 0 ? '+' : '';
      const color = changeColor(s.change);
      const bg = heatBg(s.change);
      const barW = (Math.abs(s.change) / maxAbs * 100).toFixed(1);
      return `
        <div class="sp-cell" style="background:${bg};border-color:${color}20">
          <div class="sp-cell-top">
            <span class="sp-icon">${icon}</span>
            <span class="sp-sym">${escapeHtml(s.symbol)}</span>
          </div>
          <div class="sp-name">${escapeHtml(label.replace(/\s*\(.*\)$/, ''))}</div>
          <div class="sp-bar-row">
            <div class="sp-bar-track">
              <div class="sp-bar-fill" style="width:${barW}%;background:${color}"></div>
            </div>
            <span class="sp-chg" style="color:${color}">${sign}${s.change.toFixed(2)}%</span>
          </div>
        </div>`;
    }).join('');

    const avg = sectors.reduce((s, x) => s + x.change, 0) / (sectors.length || 1);
    const best = [...sectors].sort((a, b) => b.change - a.change)[0];
    const worst = [...sectors].sort((a, b) => a.change - b.change)[0];

    const content = `
      <div class="sp-container">
        <div class="sp-toolbar">
          <div class="sp-period-bar">${periodBtns}</div>
          <div class="sp-sort-bar">${sortBtns}</div>
        </div>
        <div class="sp-summary">
          <div class="sp-stat">
            <span class="sp-stat-l">Avg</span>
            <span class="sp-stat-v" style="color:${changeColor(avg)}">${avg >= 0 ? '+' : ''}${avg.toFixed(2)}%</span>
          </div>
          <div class="sp-stat">
            <span class="sp-stat-l">Best</span>
            <span class="sp-stat-v" style="color:#4caf50">${best ? escapeHtml(best.symbol) + ' +' + best.change.toFixed(2) + '%' : 'N/A'}</span>
          </div>
          <div class="sp-stat">
            <span class="sp-stat-l">Worst</span>
            <span class="sp-stat-v" style="color:#f44336">${worst ? escapeHtml(worst.symbol) + ' ' + worst.change.toFixed(2) + '%' : 'N/A'}</span>
          </div>
        </div>
        ${breadthBar(sectors)}
        <div class="sp-grid">${grid}</div>
        <div class="yc-footer">US Sector ETFs · ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
      </div>`;

    this.setContent(content);
    this.attachListeners();
  }

  private attachListeners(): void {
    this.element?.querySelectorAll('.sp-period-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const p = (e.currentTarget as HTMLElement).dataset['period'] as PeriodMode;
        if (p && p !== this.period) { this.period = p; void this.fetchData(); }
      });
    });
    this.element?.querySelectorAll('.sp-sort-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const s = (e.currentTarget as HTMLElement).dataset['sort'] as SortMode;
        if (s) { this.sort = s; this.renderPanel(); }
      });
    });
  }
}
