import { Panel } from './Panel';
import { t } from '@/services/i18n';
import { escapeHtml } from '@/utils/sanitize';
import { EconomicServiceClient } from '@/generated/client/worldmonitor/economic/v1/service_client';
import type { BisCreditToGdp } from '@/generated/client/worldmonitor/economic/v1/service_client';

// Risk thresholds based on BIS research (credit-to-GDP gap)
// A ratio above 100% is considered elevated; above 150% critical
const RISK_THRESHOLD_HIGH   = 150;
const RISK_THRESHOLD_MEDIUM = 100;
const RISK_THRESHOLD_LOW    = 70;

type SortMode = 'ratio-desc' | 'ratio-asc' | 'change-desc' | 'change-asc';
type RiskFilter = 'all' | 'critical' | 'elevated' | 'moderate';

function riskLevel(ratio: number): { label: string; cls: string; color: string } {
  if (ratio >= RISK_THRESHOLD_HIGH)   return { label: 'Critical', cls: 'cr-risk-critical', color: '#f44336' };
  if (ratio >= RISK_THRESHOLD_MEDIUM) return { label: 'Elevated', cls: 'cr-risk-elevated', color: '#ff9800' };
  if (ratio >= RISK_THRESHOLD_LOW)    return { label: 'Moderate', cls: 'cr-risk-moderate', color: '#ffeb3b' };
  return { label: 'Low', cls: 'cr-risk-low', color: '#4caf50' };
}

function barWidth(ratio: number): number {
  return Math.min(100, (ratio / 200) * 100);
}

const economicClient = new EconomicServiceClient('', { fetch: (...args) => globalThis.fetch(...args) });

export class CreditRiskPanel extends Panel {
  private entries: BisCreditToGdp[] = [];
  private loading = true;
  private error: string | null = null;
  private sort: SortMode = 'ratio-desc';
  private filter: RiskFilter = 'all';

  constructor() {
    super({ id: 'credit-risk', title: t('panels.creditRisk'), showCount: false });
    void this.fetchData();
  }

  public async fetchData(): Promise<void> {
    this.loading = true;
    this.error = null;
    this.renderPanel();
    try {
      const resp = await economicClient.getBisCredit({});
      this.entries = resp.entries ?? [];
      this.loading = false;
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to load BIS credit data';
      this.loading = false;
    }
    if (!this.element?.isConnected) return;
    this.renderPanel();
    setTimeout(() => { if (this.element?.isConnected) void this.fetchData(); }, 30 * 60 * 1000);
  }

  private visibleEntries(): BisCreditToGdp[] {
    let list = [...this.entries];

    if (this.filter === 'critical') list = list.filter(e => e.creditGdpRatio >= RISK_THRESHOLD_HIGH);
    if (this.filter === 'elevated') list = list.filter(e => e.creditGdpRatio >= RISK_THRESHOLD_MEDIUM && e.creditGdpRatio < RISK_THRESHOLD_HIGH);
    if (this.filter === 'moderate') list = list.filter(e => e.creditGdpRatio >= RISK_THRESHOLD_LOW && e.creditGdpRatio < RISK_THRESHOLD_MEDIUM);

    switch (this.sort) {
      case 'ratio-desc':  list.sort((a, b) => b.creditGdpRatio - a.creditGdpRatio); break;
      case 'ratio-asc':   list.sort((a, b) => a.creditGdpRatio - b.creditGdpRatio); break;
      case 'change-desc': list.sort((a, b) => (b.creditGdpRatio - b.previousRatio) - (a.creditGdpRatio - a.previousRatio)); break;
      case 'change-asc':  list.sort((a, b) => (a.creditGdpRatio - a.previousRatio) - (b.creditGdpRatio - b.previousRatio)); break;
    }
    return list;
  }

  protected renderPanel(): void {
    if (this.loading) { this.showLoading(); return; }
    if (this.error || !this.entries.length) { this.showError(this.error ?? 'No BIS data'); return; }

    const visible = this.visibleEntries();
    const critical = this.entries.filter(e => e.creditGdpRatio >= RISK_THRESHOLD_HIGH).length;
    const elevated  = this.entries.filter(e => e.creditGdpRatio >= RISK_THRESHOLD_MEDIUM && e.creditGdpRatio < RISK_THRESHOLD_HIGH).length;
    const avgRatio  = this.entries.reduce((s, e) => s + e.creditGdpRatio, 0) / this.entries.length;

    const sortBtns: Array<{k: SortMode; label: string}> = [
      { k: 'ratio-desc', label: 'Ratio ▼' },
      { k: 'ratio-asc',  label: 'Ratio ▲' },
      { k: 'change-desc',label: 'Δ ▼' },
      { k: 'change-asc', label: 'Δ ▲' },
    ];
    const filterBtns: Array<{k: RiskFilter; label: string}> = [
      { k: 'all', label: 'All' },
      { k: 'critical', label: '🔴 Critical' },
      { k: 'elevated', label: '🟠 Elevated' },
      { k: 'moderate', label: '🟡 Moderate' },
    ];

    const sBar = sortBtns.map(s =>
      `<button class="cr-sort-btn${this.sort === s.k ? ' active' : ''}" data-sort="${s.k}">${s.label}</button>`,
    ).join('');

    const fBar = filterBtns.map(f =>
      `<button class="cr-filter-btn${this.filter === f.k ? ' active' : ''}" data-filter="${f.k}">${f.label}</button>`,
    ).join('');

    const rows = visible.map(e => {
      const delta = e.creditGdpRatio - e.previousRatio;
      const { label, cls, color } = riskLevel(e.creditGdpRatio);
      const sign = delta > 0 ? '+' : '';
      const deltaColor = delta > 2 ? '#f44336' : delta > 0 ? '#ff9800' : delta < -2 ? '#4caf50' : '#90a4ae';
      return `
        <div class="cr-row">
          <div class="cr-country-info">
            <span class="cr-country">${escapeHtml(e.countryName)}</span>
            <span class="cr-code">${escapeHtml(e.countryCode)}</span>
          </div>
          <div class="cr-bar-col">
            <div class="cr-bar-track">
              <div class="cr-bar-fill" style="width:${barWidth(e.creditGdpRatio)}%;background:${color}"></div>
            </div>
            <span class="cr-ratio">${e.creditGdpRatio.toFixed(1)}%</span>
          </div>
          <div class="cr-meta">
            <span class="cr-badge ${cls}">${label}</span>
            <span class="cr-delta" style="color:${deltaColor}">${sign}${delta.toFixed(1)}%</span>
          </div>
        </div>`;
    }).join('');

    const content = `
      <div class="cr-container">
        <div class="cr-toolbar">
          <div class="cr-filter-bar">${fBar}</div>
          <div class="cr-sort-bar">${sBar}</div>
        </div>
        <div class="cr-summary">
          <span class="cr-sum-item"><span class="cr-sum-val cr-sum-critical">${critical}</span> critical</span>
          <span class="cr-sum-item"><span class="cr-sum-val cr-sum-elevated">${elevated}</span> elevated</span>
          <span class="cr-sum-item">avg <span class="cr-sum-val">${avgRatio.toFixed(0)}%</span></span>
        </div>
        <div class="cr-list">${rows}</div>
        <div class="yc-footer">BIS Credit-to-GDP · ${this.entries[0]?.date ?? ''}</div>
      </div>`;

    this.setContent(content);

    this.element?.querySelectorAll('.cr-sort-btn').forEach(btn =>
      btn.addEventListener('click', e => {
        const s = (e.currentTarget as HTMLElement).dataset['sort'] as SortMode;
        if (s) { this.sort = s; this.renderPanel(); }
      }),
    );
    this.element?.querySelectorAll('.cr-filter-btn').forEach(btn =>
      btn.addEventListener('click', e => {
        const f = (e.currentTarget as HTMLElement).dataset['filter'] as RiskFilter;
        if (f) { this.filter = f; this.renderPanel(); }
      }),
    );
  }
}
