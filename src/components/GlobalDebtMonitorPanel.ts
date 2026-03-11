import { Panel } from './Panel';
import { t } from '@/services/i18n';
import { escapeHtml } from '@/utils/sanitize';
import { EconomicServiceClient } from '@/generated/client/worldmonitor/economic/v1/service_client';
import type { BisCreditToGdp } from '@/generated/client/worldmonitor/economic/v1/service_client';

const econClient = new EconomicServiceClient('', { fetch: (...args) => globalThis.fetch(...args) });

// Debt sustainability thresholds (% of GDP) based on IMF/BIS research
const DEBT_DANGER = 120;   // >120% = danger
const DEBT_WARNING = 80;   // >80%  = warning
const DEBT_MODERATE = 50;  // >50%  = moderate

type SortKey = 'ratio' | 'change' | 'name';
type SortDir = 'asc' | 'desc';
type RiskView = 'all' | 'danger' | 'warning' | 'safe';

interface DebtEntry {
  country: string;
  ratio: number;
  prevRatio: number;
  change: number;
  risk: 'danger' | 'warning' | 'moderate' | 'safe';
}

function classifyRisk(ratio: number): DebtEntry['risk'] {
  if (ratio >= DEBT_DANGER)  return 'danger';
  if (ratio >= DEBT_WARNING) return 'warning';
  if (ratio >= DEBT_MODERATE) return 'moderate';
  return 'safe';
}

const RISK_STYLE: Record<string, { label: string; color: string; bg: string }> = {
  danger:   { label: 'Critical',  color: '#f44336', bg: 'rgba(244,67,54,0.12)' },
  warning:  { label: 'Elevated',  color: '#ff9800', bg: 'rgba(255,152,0,0.10)' },
  moderate: { label: 'Moderate',  color: '#ffc107', bg: 'rgba(255,193,7,0.08)' },
  safe:     { label: 'Low',       color: '#4caf50', bg: 'rgba(76,175,80,0.08)' },
};

export class GlobalDebtMonitorPanel extends Panel {
  private entries: DebtEntry[] = [];
  private loading = true;
  private error: string | null = null;
  private sortKey: SortKey = 'ratio';
  private sortDir: SortDir = 'desc';
  private riskView: RiskView = 'all';

  constructor() {
    super({ id: 'global-debt', title: t('panels.globalDebt'), showCount: true });
    void this.fetchData();
  }

  public async fetchData(): Promise<void> {
    this.loading = true;
    this.error = null;
    this.showLoading();
    try {
      const resp = await econClient.getBisCredit({});
      const raw: BisCreditToGdp[] = resp.entries ?? [];
      this.entries = raw.map(e => ({
        country: e.countryName || e.countryCode,
        ratio: e.creditGdpRatio,
        prevRatio: e.previousRatio,
        change: e.creditGdpRatio - e.previousRatio,
        risk: classifyRisk(e.creditGdpRatio),
      }));
      this.setCount(this.entries.length);
      this.loading = false;
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to load debt data';
      this.loading = false;
    }
    if (this.element?.isConnected) this.renderPanel();
    setTimeout(() => { if (this.element?.isConnected) void this.fetchData(); }, 30 * 60 * 1000);
  }

  private filtered(): DebtEntry[] {
    let list = [...this.entries];
    if (this.riskView === 'danger') list = list.filter(e => e.risk === 'danger');
    else if (this.riskView === 'warning') list = list.filter(e => e.risk === 'warning' || e.risk === 'danger');
    else if (this.riskView === 'safe') list = list.filter(e => e.risk === 'safe' || e.risk === 'moderate');

    const dir = this.sortDir === 'asc' ? 1 : -1;
    switch (this.sortKey) {
      case 'ratio':  list.sort((a, b) => (a.ratio - b.ratio) * dir); break;
      case 'change': list.sort((a, b) => (a.change - b.change) * dir); break;
      case 'name':   list.sort((a, b) => a.country.localeCompare(b.country) * dir); break;
    }
    return list;
  }

  protected renderPanel(): void {
    if (this.loading) { this.showLoading(); return; }
    if (this.error || !this.entries.length) { this.showError(this.error ?? 'No data'); return; }

    const dangerCount = this.entries.filter(e => e.risk === 'danger').length;
    const warnCount = this.entries.filter(e => e.risk === 'warning').length;
    const avgRatio = this.entries.reduce((s, e) => s + e.ratio, 0) / this.entries.length;

    const summary = `<div class="gd-summary" style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:12px">
      <div style="text-align:center;background:rgba(244,67,54,0.1);border-radius:6px;padding:8px">
        <div style="font-size:20px;font-weight:700;color:#f44336">${dangerCount}</div>
        <div style="font-size:10px;color:rgba(255,255,255,0.5)">Critical</div>
      </div>
      <div style="text-align:center;background:rgba(255,152,0,0.1);border-radius:6px;padding:8px">
        <div style="font-size:20px;font-weight:700;color:#ff9800">${warnCount}</div>
        <div style="font-size:10px;color:rgba(255,255,255,0.5)">Elevated</div>
      </div>
      <div style="text-align:center;background:rgba(66,165,245,0.1);border-radius:6px;padding:8px">
        <div style="font-size:20px;font-weight:700;color:#42a5f5">${avgRatio.toFixed(1)}%</div>
        <div style="font-size:10px;color:rgba(255,255,255,0.5)">Avg Debt/GDP</div>
      </div>
    </div>`;

    const filterBtns = (['all', 'danger', 'warning', 'safe'] as RiskView[]).map(v => {
      const labels: Record<RiskView, string> = { all: 'All', danger: 'Critical', warning: '≥ Elevated', safe: 'Healthy' };
      const active = this.riskView === v;
      return `<button class="gd-filter" data-filter="${v}" style="padding:3px 8px;border-radius:4px;border:none;font-size:10px;cursor:pointer;background:${active ? 'rgba(66,165,245,0.2)' : 'rgba(255,255,255,0.05)'};color:${active ? '#42a5f5' : 'rgba(255,255,255,0.5)'}">${labels[v]}</button>`;
    }).join('');

    const list = this.filtered();
    const rows = list.slice(0, 30).map(e => {
      const s = RISK_STYLE[e.risk] ?? RISK_STYLE.safe;
      const barW = Math.min(100, (e.ratio / 250) * 100);
      const changeStr = e.change >= 0 ? `+${e.change.toFixed(1)}` : e.change.toFixed(1);
      const changeColor = e.change > 2 ? '#f44336' : e.change < -2 ? '#4caf50' : 'rgba(255,255,255,0.5)';
      return `<div style="display:flex;align-items:center;gap:6px;padding:5px 8px;background:${s.bg};border-radius:4px;margin-bottom:3px">
        <div style="flex:1;min-width:0">
          <div style="font-size:12px;color:rgba(255,255,255,0.85);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(e.country)}</div>
        </div>
        <div style="width:60px;height:5px;background:rgba(255,255,255,0.06);border-radius:3px;overflow:hidden">
          <div style="width:${barW}%;height:100%;background:${s.color};border-radius:3px"></div>
        </div>
        <div style="width:48px;text-align:right;font-size:12px;font-weight:600;color:${s.color}">${e.ratio.toFixed(1)}%</div>
        <div style="width:40px;text-align:right;font-size:10px;color:${changeColor}">${changeStr}</div>
      </div>`;
    }).join('');

    const html = `${summary}
      <div style="display:flex;gap:4px;margin-bottom:8px">${filterBtns}</div>
      <div class="gd-list">${rows}</div>
      ${list.length > 30 ? `<div style="text-align:center;font-size:10px;color:rgba(255,255,255,0.4);margin-top:6px">Showing 30 of ${list.length}</div>` : ''}
      <div style="font-size:10px;color:rgba(255,255,255,0.35);margin-top:8px;text-align:center">
        Source: BIS credit statistics • Debt = Total credit to non-financial sector (% GDP)
      </div>`;

    this.setContent(html);

    this.element?.querySelectorAll('.gd-filter').forEach(btn => {
      btn.addEventListener('click', () => {
        this.riskView = (btn as HTMLElement).dataset.filter as RiskView;
        this.renderPanel();
      });
    });
  }
}
