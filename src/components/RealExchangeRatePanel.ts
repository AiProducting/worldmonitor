import { Panel } from './Panel';
import { t } from '@/services/i18n';
import { escapeHtml } from '@/utils/sanitize';
import { EconomicServiceClient } from '@/generated/client/worldmonitor/economic/v1/service_client';
import type { BisExchangeRate } from '@/generated/client/worldmonitor/economic/v1/service_client';

// Real Effective Exchange Rate (REER) and Nominal EER from BIS
// REER > 100 means currency is overvalued relative to its trade-weighted basket

type SortMode = 'reer-desc' | 'reer-asc' | 'change-desc' | 'change-asc';

const PRIORITY_COUNTRIES = ['US', 'EU', 'JP', 'GB', 'CN', 'CH', 'CA', 'AU', 'BR', 'IN', 'KR', 'MX', 'RU', 'ZA', 'TR'];

const FLAG_MAP: Record<string, string> = {
  US: '🇺🇸', EU: '🇪🇺', JP: '🇯🇵', GB: '🇬🇧', CN: '🇨🇳', CH: '🇨🇭', CA: '🇨🇦', AU: '🇦🇺',
  BR: '🇧🇷', IN: '🇮🇳', KR: '🇰🇷', MX: '🇲🇽', RU: '🇷🇺', ZA: '🇿🇦', TR: '🇹🇷',
  SE: '🇸🇪', NO: '🇳🇴', DK: '🇩🇰', NZ: '🇳🇿', SG: '🇸🇬', HK: '🇭🇰', TW: '🇹🇼',
  SA: '🇸🇦', AE: '🇦🇪', PL: '🇵🇱', HU: '🇭🇺', CZ: '🇨🇿', ID: '🇮🇩', TH: '🇹🇭', MY: '🇲🇾',
};

const economicClient = new EconomicServiceClient('', { fetch: (...args) => globalThis.fetch(...args) });

function overvaluation(reer: number): { label: string; color: string } {
  if (reer >= 120)     return { label: 'Strongly OV', color: '#f44336' };
  if (reer >= 110)     return { label: 'Overvalued', color: '#ff9800' };
  if (reer <= 80)      return { label: 'Undervalued', color: '#4caf50' };
  if (reer <= 90)      return { label: 'Slightly UV', color: '#8bc34a' };
  return { label: 'Neutral', color: '#90a4ae' };
}

export class RealExchangeRatePanel extends Panel {
  private rates: BisExchangeRate[] = [];
  private loading = true;
  private error: string | null = null;
  private sortMode: SortMode = 'reer-desc';
  private priorityOnly = true;

  constructor() {
    super({ id: 'real-exchange-rate', title: t('panels.realExchangeRate'), showCount: false });
    void this.fetchData();
  }

  public async fetchData(): Promise<void> {
    this.loading = true;
    this.error = null;
    this.renderPanel();
    try {
      const resp = await economicClient.getBisExchangeRates({});
      this.rates = resp.rates ?? [];
      this.loading = false;
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to load BIS exchange rate data';
      this.loading = false;
    }
    if (!this.element?.isConnected) return;
    this.renderPanel();
    setTimeout(() => { if (this.element?.isConnected) void this.fetchData(); }, 30 * 60 * 1000);
  }

  private sortedList(entries: BisExchangeRate[]): BisExchangeRate[] {
    const sorted = [...entries];
    switch (this.sortMode) {
      case 'reer-desc':   sorted.sort((a, b) => b.realEer - a.realEer); break;
      case 'reer-asc':    sorted.sort((a, b) => a.realEer - b.realEer); break;
      case 'change-desc': sorted.sort((a, b) => b.realChange - a.realChange); break;
      case 'change-asc':  sorted.sort((a, b) => a.realChange - b.realChange); break;
    }
    return sorted;
  }

  private visibleRates(): BisExchangeRate[] {
    let list = this.priorityOnly
      ? this.rates.filter(r => PRIORITY_COUNTRIES.includes(r.countryCode))
      : [...this.rates];
    // Sort priority by order if not re-sorted
    if (this.sortMode === 'reer-desc' && this.priorityOnly) {
      list.sort((a, b) => {
        const ai = PRIORITY_COUNTRIES.indexOf(a.countryCode);
        const bi = PRIORITY_COUNTRIES.indexOf(b.countryCode);
        if (ai === -1 && bi === -1) return b.realEer - a.realEer;
        if (ai === -1) return 1;
        if (bi === -1) return -1;
        return b.realEer - a.realEer;
      });
    } else {
      list = this.sortedList(list);
    }
    return list;
  }

  protected renderPanel(): void {
    if (this.loading) { this.showLoading(); return; }
    if (this.error || !this.rates.length) { this.showError(this.error ?? 'No BIS data'); return; }

    const visible = this.visibleRates();
    const overvalued  = visible.filter(r => r.realEer >= 110).length;
    const undervalued = visible.filter(r => r.realEer <= 90).length;

    const sortBtns: Array<{k: SortMode; label: string}> = [
      { k: 'reer-desc', label: 'REER ▼' },
      { k: 'reer-asc',  label: 'REER ▲' },
      { k: 'change-desc', label: 'Δ ▼' },
      { k: 'change-asc',  label: 'Δ ▲' },
    ];

    const sBar = sortBtns.map(s =>
      `<button class="reer-sort-btn${this.sortMode === s.k ? ' active' : ''}" data-sort="${s.k}">${s.label}</button>`,
    ).join('');

    const rows = visible.map(r => {
      const flag = FLAG_MAP[r.countryCode] ?? '🌐';
      const { label, color } = overvaluation(r.realEer);
      const sign = r.realChange > 0 ? '+' : '';
      const deltaColor = r.realChange > 2 ? '#f44336' : r.realChange > 0 ? '#ff9800' : r.realChange < -2 ? '#4caf50' : '#90a4ae';
      // REER bar: 100 = neutral, scale 60-140
      const barPct = Math.min(100, Math.max(0, ((r.realEer - 60) / 80) * 100));
      const centerPct = ((100 - 60) / 80) * 100;
      return `
        <div class="reer-row">
          <span class="reer-flag">${flag}</span>
          <div class="reer-country">
            <span class="reer-name">${escapeHtml(r.countryName)}</span>
            <span class="reer-code">${escapeHtml(r.countryCode)}</span>
          </div>
          <div class="reer-bar-col">
            <div class="reer-bar-track">
              <div class="reer-center-line" style="left:${centerPct.toFixed(1)}%"></div>
              <div class="reer-bar-fill" style="width:${barPct.toFixed(1)}%;background:${color}"></div>
            </div>
            <span class="reer-val">${r.realEer.toFixed(1)}</span>
          </div>
          <div class="reer-meta">
            <span class="reer-label" style="color:${color}">${label}</span>
            <span class="reer-delta" style="color:${deltaColor}">${sign}${r.realChange.toFixed(2)}%</span>
          </div>
        </div>`;
    }).join('');

    const filterBtn = `<button class="reer-toggle-btn${this.priorityOnly ? ' active' : ''}" data-toggle="priority">G20+</button>
      <button class="reer-toggle-btn${!this.priorityOnly ? ' active' : ''}" data-toggle="all">All</button>`;

    const content = `
      <div class="reer-container">
        <div class="reer-toolbar">
          <div class="reer-filter-bar">${filterBtn}</div>
          <div class="reer-sort-bar">${sBar}</div>
        </div>
        <div class="reer-summary">
          <span class="reer-sum-item"><span class="reer-ov">${overvalued}</span> overvalued (≥110)</span>
          <span class="reer-sum-item"><span class="reer-uv">${undervalued}</span> undervalued (≤90)</span>
        </div>
        <div class="reer-note">REER = 100 means currency at fair value vs. trade-weighted basket</div>
        <div class="reer-list">${rows}</div>
        <div class="yc-footer">BIS Effective Exchange Rates · ${this.rates[0]?.date ?? ''}</div>
      </div>`;

    this.setContent(content);

    this.element?.querySelectorAll('.reer-sort-btn').forEach(btn =>
      btn.addEventListener('click', e => {
        const s = (e.currentTarget as HTMLElement).dataset['sort'] as SortMode;
        if (s) { this.sortMode = s; this.renderPanel(); }
      }),
    );
    this.element?.querySelectorAll('.reer-toggle-btn').forEach(btn =>
      btn.addEventListener('click', e => {
        const t = (e.currentTarget as HTMLElement).dataset['toggle'];
        this.priorityOnly = t === 'priority';
        this.renderPanel();
      }),
    );
  }
}
