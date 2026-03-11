import { Panel } from './Panel';
import { t } from '@/services/i18n';
import { escapeHtml } from '@/utils/sanitize';
import { EconomicServiceClient } from '@/generated/client/worldmonitor/economic/v1/service_client';
import type { EnergyPrice } from '@/generated/client/worldmonitor/economic/v1/service_client';

// Available commodity codes from EIA/energy API
const ENERGY_COMMODITIES = ['WTI', 'BRENT', 'NATGAS', 'RBOB', 'HEATOIL', 'COAL', 'URANIUM', 'LNG'];

const ENERGY_META: Record<string, { name: string; icon: string; unit: string; group: string }> = {
  WTI:      { name: 'WTI Crude',     icon: '🛢️',  unit: '$/bbl', group: 'Oil' },
  BRENT:    { name: 'Brent Crude',   icon: '🛢️',  unit: '$/bbl', group: 'Oil' },
  NATGAS:   { name: 'Natural Gas',   icon: '🔥',  unit: '$/MMBtu', group: 'Gas' },
  RBOB:     { name: 'RBOB Gasoline', icon: '⛽',  unit: '$/gal', group: 'Oil' },
  HEATOIL:  { name: 'Heating Oil',   icon: '♨️',  unit: '$/gal', group: 'Oil' },
  COAL:     { name: 'Coal',          icon: '⚫',  unit: '$/ton', group: 'Coal' },
  URANIUM:  { name: 'Uranium',       icon: '☢️',  unit: '$/lb', group: 'Nuclear' },
  LNG:      { name: 'LNG',           icon: '🧊',  unit: '$/MMBtu', group: 'Gas' },
};

const GROUP_ORDER = ['Oil', 'Gas', 'Coal', 'Nuclear'];

type GroupFilter = 'All' | 'Oil' | 'Gas' | 'Coal' | 'Nuclear';

const economicClient = new EconomicServiceClient('', { fetch: (...args) => globalThis.fetch(...args) });

export class EnergyPricesPanel extends Panel {
  private prices: EnergyPrice[] = [];
  private loading = true;
  private error: string | null = null;
  private group: GroupFilter = 'All';

  constructor() {
    super({ id: 'energy-prices', title: t('panels.energyPrices'), showCount: false });
    void this.fetchData();
  }

  public async fetchData(): Promise<void> {
    this.loading = true;
    this.error = null;
    this.renderPanel();
    try {
      const resp = await economicClient.getEnergyPrices({ commodities: ENERGY_COMMODITIES });
      this.prices = resp.prices ?? [];
      this.loading = false;
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to load energy prices';
      this.loading = false;
    }
    if (!this.element?.isConnected) return;
    this.renderPanel();
    setTimeout(() => { if (this.element?.isConnected) void this.fetchData(); }, 10 * 60 * 1000);
  }

  private visiblePrices(): EnergyPrice[] {
    let list = [...this.prices];
    if (this.group !== 'All') {
      list = list.filter(p => {
        const meta = ENERGY_META[p.commodity?.toUpperCase() ?? ''];
        return meta?.group === this.group;
      });
    }
    // Sort by group order
    list.sort((a, b) => {
      const grpA = GROUP_ORDER.indexOf(ENERGY_META[a.commodity?.toUpperCase() ?? '']?.group ?? '');
      const grpB = GROUP_ORDER.indexOf(ENERGY_META[b.commodity?.toUpperCase() ?? '']?.group ?? '');
      return grpA - grpB;
    });
    return list;
  }

  private calcSpread(): { label: string; value: string } | null {
    const wti    = this.prices.find(p => p.commodity?.toUpperCase() === 'WTI');
    const brent  = this.prices.find(p => p.commodity?.toUpperCase() === 'BRENT');
    if (!wti || !brent) return null;
    const spread = brent.price - wti.price;
    return { label: 'Brent-WTI Spread', value: `$${spread >= 0 ? '+' : ''}${spread.toFixed(2)}/bbl` };
  }

  protected renderPanel(): void {
    if (this.loading) { this.showLoading(); return; }
    if (this.error || !this.prices.length) { this.showError(this.error ?? 'No data'); return; }

    const visible = this.visiblePrices();
    const spread  = this.calcSpread();
    const groups: GroupFilter[] = ['All', 'Oil', 'Gas', 'Coal', 'Nuclear'];

    const gBar = groups.map(g =>
      `<button class="ep-grp-btn${this.group === g ? ' active' : ''}" data-group="${g}">${g}</button>`,
    ).join('');

    const rows = visible.map(p => {
      const key  = p.commodity?.toUpperCase() ?? '';
      const meta = ENERGY_META[key] ?? { name: escapeHtml(p.name || key), icon: '⚡', unit: p.unit || '', group: 'Other' };
      const chgCls = p.change > 0 ? 'ep-up' : p.change < 0 ? 'ep-down' : '';
      const sign = p.change > 0 ? '+' : '';
      return `
        <div class="ep-row">
          <span class="ep-icon">${meta.icon}</span>
          <div class="ep-info">
            <span class="ep-name">${escapeHtml(meta.name)}</span>
            <span class="ep-unit">${escapeHtml(meta.unit)}</span>
          </div>
          <div class="ep-price-col">
            <span class="ep-price">$${p.price >= 100 ? p.price.toFixed(0) : p.price.toFixed(2)}</span>
            <span class="ep-chg ${chgCls}">${sign}${p.change.toFixed(2)}%</span>
          </div>
        </div>`;
    }).join('');

    const spreadHtml = spread
      ? `<div class="ep-spread">${escapeHtml(spread.label)}: <span class="ep-spread-val">${escapeHtml(spread.value)}</span></div>`
      : '';

    const content = `
      <div class="ep-container">
        <div class="ep-toolbar">
          <div class="ep-grp-bar">${gBar}</div>
        </div>
        ${spreadHtml}
        <div class="ep-list">${rows}</div>
        <div class="yc-footer">EIA Energy Prices · ${new Date().toLocaleDateString()}</div>
      </div>`;

    this.setContent(content);
    this.element?.querySelectorAll('.ep-grp-btn').forEach(btn =>
      btn.addEventListener('click', e => {
        const g = (e.currentTarget as HTMLElement).dataset['group'] as GroupFilter;
        if (g) { this.group = g; this.renderPanel(); }
      }),
    );
  }
}
