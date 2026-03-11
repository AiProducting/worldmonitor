import { Panel } from './Panel';
import { t } from '@/services/i18n';
import { escapeHtml } from '@/utils/sanitize';
import { EconomicServiceClient } from '@/generated/client/worldmonitor/economic/v1/service_client';
import type { BisPolicyRate } from '@/generated/client/worldmonitor/economic/v1/service_client';
import { getHydratedData } from '@/services/bootstrap';

// Banks to highlight at the top (G10 + major EMs)
const PRIORITY_CODES = ['US', 'EU', 'JP', 'GB', 'CN', 'CH', 'CA', 'AU', 'NO', 'SE', 'NZ', 'BR', 'MX', 'IN', 'KR'];

const economicClient = new EconomicServiceClient('', { fetch: (...args) => globalThis.fetch(...args) });

function rateChangeClass(rate: number, prev: number): string {
  if (rate > prev + 0.001) return 'rate-up';
  if (rate < prev - 0.001) return 'rate-down';
  return 'rate-stable';
}

function rateChangeArrow(rate: number, prev: number): string {
  if (rate > prev + 0.001) return '▲';
  if (rate < prev - 0.001) return '▼';
  return '—';
}

function formatRate(r: number): string {
  return `${r.toFixed(2)}%`;
}

function flagEmoji(code: string): string {
  // Convert ISO 2-letter country code to flag emoji
  if (code === 'EU') return '🇪🇺';
  const chars = Array.from(code.toUpperCase());
  if (chars.length !== 2) return '';
  return String.fromCodePoint(...chars.map(c => 0x1F1E6 + c.charCodeAt(0) - 65));
}

type SortMode = 'priority' | 'rate-desc' | 'rate-asc' | 'change';

export class CentralBankRatesPanel extends Panel {
  private rates: BisPolicyRate[] = [];
  private loading = true;
  private error: string | null = null;
  private sortMode: SortMode = 'priority';

  constructor() {
    super({ id: 'central-bank-rates', title: t('panels.centralBankRates'), showCount: false });
    void this.fetchData();
  }

  public async fetchData(): Promise<void> {
    this.loading = true;
    this.error = null;
    this.renderPanel();

    const hydrated = getHydratedData('bisPolicyRates') as { rates?: BisPolicyRate[] } | undefined;
    if (hydrated?.rates?.length) {
      this.rates = hydrated.rates;
      this.loading = false;
      this.renderPanel();
      this.scheduleRefresh();
      return;
    }

    try {
      const resp = await economicClient.getBisPolicyRates({});
      this.rates = resp.rates ?? [];
      this.loading = false;
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to load policy rates';
      this.loading = false;
    }

    if (!this.element?.isConnected) return;
    this.renderPanel();
    this.scheduleRefresh();
  }

  private scheduleRefresh(): void {
    setTimeout(() => {
      if (this.element?.isConnected) void this.fetchData();
    }, 30 * 60 * 1000);
  }

  private sortedRates(): BisPolicyRate[] {
    const sorted = [...this.rates];
    if (this.sortMode === 'priority') {
      sorted.sort((a, b) => {
        const ai = PRIORITY_CODES.indexOf(a.countryCode);
        const bi = PRIORITY_CODES.indexOf(b.countryCode);
        if (ai === -1 && bi === -1) return a.countryName.localeCompare(b.countryName);
        if (ai === -1) return 1;
        if (bi === -1) return -1;
        return ai - bi;
      });
    } else if (this.sortMode === 'rate-desc') {
      sorted.sort((a, b) => b.rate - a.rate);
    } else if (this.sortMode === 'rate-asc') {
      sorted.sort((a, b) => a.rate - b.rate);
    } else if (this.sortMode === 'change') {
      sorted.sort((a, b) => Math.abs(b.rate - b.previousRate) - Math.abs(a.rate - a.previousRate));
    }
    return sorted;
  }

  protected renderPanel(): void {
    if (this.loading) {
      this.showLoading();
      return;
    }
    if (this.error || !this.rates.length) {
      this.showError(this.error ?? 'No data');
      return;
    }

    const rates = this.sortedRates();
    const changed = rates.filter(r => Math.abs(r.rate - r.previousRate) > 0.001);
    const avgRate = rates.reduce((s, r) => s + r.rate, 0) / rates.length;

    const sortButtons = (['priority', 'rate-desc', 'rate-asc', 'change'] as SortMode[]).map(mode => {
      const labels: Record<SortMode, string> = {
        priority: 'G10 first',
        'rate-desc': 'Rate ↓',
        'rate-asc': 'Rate ↑',
        change: 'Changed',
      };
      const active = this.sortMode === mode ? ' active' : '';
      return `<button class="cbr-sort-btn${active}" data-sort="${mode}">${labels[mode]}</button>`;
    }).join('');

    const rows = rates.map(r => {
      const cls = rateChangeClass(r.rate, r.previousRate);
      const arrow = rateChangeArrow(r.rate, r.previousRate);
      const diff = r.rate - r.previousRate;
      const diffStr = Math.abs(diff) > 0.001 ? `(${diff > 0 ? '+' : ''}${diff.toFixed(2)})` : '';
      const flag = flagEmoji(r.countryCode);
      const isPriority = PRIORITY_CODES.includes(r.countryCode);

      return `
        <div class="cbr-row ${isPriority ? 'cbr-priority' : ''}">
          <span class="cbr-flag">${flag}</span>
          <div class="cbr-bank-info">
            <span class="cbr-bank-name">${escapeHtml(r.centralBank)}</span>
            <span class="cbr-date">${escapeHtml(r.date)}</span>
          </div>
          <div class="cbr-rate-col">
            <span class="cbr-rate ${cls}">${formatRate(r.rate)}</span>
            <span class="cbr-change ${cls}">${arrow} ${escapeHtml(diffStr)}</span>
          </div>
        </div>`;
    }).join('');

    const content = `
      <div class="cbr-container">
        <div class="cbr-summary">
          <div class="cbr-stat">
            <span class="cbr-stat-label">Banks tracked</span>
            <span class="cbr-stat-value">${rates.length}</span>
          </div>
          <div class="cbr-stat">
            <span class="cbr-stat-label">Avg rate</span>
            <span class="cbr-stat-value">${avgRate.toFixed(2)}%</span>
          </div>
          <div class="cbr-stat">
            <span class="cbr-stat-label">Rate changes</span>
            <span class="cbr-stat-value ${changed.length > 0 ? 'rate-up' : ''}">${changed.length}</span>
          </div>
        </div>
        <div class="cbr-sort-bar">
          ${sortButtons}
        </div>
        <div class="cbr-list">
          ${rows}
        </div>
        <div class="yc-footer">BIS Policy Rates · ${new Date().toLocaleDateString()}</div>
      </div>`;

    this.setContent(content);
    this.attachSortListeners();
  }

  private attachSortListeners(): void {
    this.element?.querySelectorAll('.cbr-sort-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const mode = (e.currentTarget as HTMLElement).dataset['sort'] as SortMode;
        if (mode) {
          this.sortMode = mode;
          this.renderPanel();
        }
      });
    });
  }
}
