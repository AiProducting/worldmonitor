import { Panel } from './Panel';
import { t } from '@/services/i18n';
import { escapeHtml } from '@/utils/sanitize';
import { EconomicServiceClient } from '@/generated/client/worldmonitor/economic/v1/service_client';
import type { EnergyCapacitySeries } from '@/generated/client/worldmonitor/economic/v1/service_client';

// Global energy transition: renewable capacity growth over time
const ENERGY_SOURCES = ['solar', 'wind', 'hydro', 'nuclear', 'coal', 'gas', 'oil'];
const YEARS = 15;

const SOURCE_META: Record<string, { name: string; icon: string; color: string; renewable: boolean }> = {
  solar:   { name: 'Solar',    icon: '☀️',  color: '#fdd835', renewable: true },
  wind:    { name: 'Wind',     icon: '💨',  color: '#4fc3f7', renewable: true },
  hydro:   { name: 'Hydro',    icon: '💧',  color: '#29b6f6', renewable: true },
  nuclear: { name: 'Nuclear',  icon: '⚛️',  color: '#ab47bc', renewable: false },
  coal:    { name: 'Coal',     icon: '⚫',  color: '#78909c', renewable: false },
  gas:     { name: 'Gas',      icon: '🔥',  color: '#ff8f00', renewable: false },
  oil:     { name: 'Oil',      icon: '🛢️',  color: '#795548', renewable: false },
};

type ViewFilter = 'all' | 'renewable' | 'fossil';

const economicClient = new EconomicServiceClient('', { fetch: (...args) => globalThis.fetch(...args) });

function trendLine(data: Array<{ year: number; capacityMw: number }>, width = 60, height = 20): string {
  if (!data || data.length < 2) return '';
  const vals = data.map(d => d.capacityMw);
  const minV = Math.min(...vals), maxV = Math.max(...vals);
  const rng = maxV - minV || 1;
  const pts = vals.map((v, i) => {
    const x = (i / (vals.length - 1)) * width;
    const y = height - ((v - minV) / rng) * (height - 2) - 1;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const last = vals[vals.length - 1]!;
  const first = vals[0]!;
  const up = last >= first;
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" class="ecp-spark"><polyline points="${pts}" fill="none" stroke="${up ? '#4caf50' : '#f44336'}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function fmtMW(mw: number): string {
  if (mw >= 1_000_000) return `${(mw / 1_000_000).toFixed(1)} TW`;
  if (mw >= 1_000)     return `${(mw / 1_000).toFixed(1)} GW`;
  return `${mw.toFixed(0)} MW`;
}

function calcCAGR(series: EnergyCapacitySeries): number | null {
  const data = series.data;
  if (!data || data.length < 2) return null;
  const first = data[0]!.capacityMw;
  const last  = data[data.length - 1]!.capacityMw;
  if (first <= 0) return null;
  const years = data[data.length - 1]!.year - data[0]!.year;
  if (years <= 0) return null;
  return (Math.pow(last / first, 1 / years) - 1) * 100;
}

export class EnergyCapacityPanel extends Panel {
  private series: EnergyCapacitySeries[] = [];
  private loading = true;
  private error: string | null = null;
  private view: ViewFilter = 'all';

  constructor() {
    super({ id: 'energy-capacity', title: t('panels.energyCapacity'), showCount: false });
    void this.fetchData();
  }

  public async fetchData(): Promise<void> {
    this.loading = true;
    this.error = null;
    this.renderPanel();
    try {
      const resp = await economicClient.getEnergyCapacity({ energySources: ENERGY_SOURCES, years: YEARS });
      this.series = resp.series ?? [];
      this.loading = false;
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to load capacity data';
      this.loading = false;
    }
    if (!this.element?.isConnected) return;
    this.renderPanel();
    setTimeout(() => { if (this.element?.isConnected) void this.fetchData(); }, 60 * 60 * 1000);
  }

  private visibleSeries(): EnergyCapacitySeries[] {
    if (this.view === 'renewable') return this.series.filter(s => SOURCE_META[s.energySource]?.renewable);
    if (this.view === 'fossil')    return this.series.filter(s => !SOURCE_META[s.energySource]?.renewable);
    return [...this.series];
  }

  protected renderPanel(): void {
    if (this.loading) { this.showLoading(); return; }
    if (this.error || !this.series.length) { this.showError(this.error ?? 'No data'); return; }

    const visible = this.visibleSeries();
    const renewables = this.series.filter(s => SOURCE_META[s.energySource]?.renewable);
    const totalRenew = renewables.reduce((acc, s) => {
      const last = s.data[s.data.length - 1];
      return acc + (last?.capacityMw ?? 0);
    }, 0);
    const totalAll = this.series.reduce((acc, s) => {
      const last = s.data[s.data.length - 1];
      return acc + (last?.capacityMw ?? 0);
    }, 0);
    const renewShare = totalAll > 0 ? (totalRenew / totalAll) * 100 : 0;

    const viewBtns: ViewFilter[] = ['all', 'renewable', 'fossil'];
    const vBar = viewBtns.map(v =>
      `<button class="ecp-view-btn${this.view === v ? ' active' : ''}" data-view="${v}">${v.charAt(0).toUpperCase() + v.slice(1)}</button>`,
    ).join('');

    // Max capacity for bar scaling
    const maxCap = Math.max(...visible.map(s => {
      const last = s.data[s.data.length - 1];
      return last?.capacityMw ?? 0;
    }));

    const rows = visible.map(s => {
      const meta = SOURCE_META[s.energySource] ?? { name: s.name || s.energySource, icon: '⚡', color: '#90a4ae', renewable: false };
      const latest = s.data[s.data.length - 1];
      const cagr = calcCAGR(s);
      const cagrColor = (cagr ?? 0) > 5 ? '#4caf50' : (cagr ?? 0) > 0 ? '#8bc34a' : '#f44336';
      const barPct = maxCap > 0 && latest ? (latest.capacityMw / maxCap) * 100 : 0;
      return `
        <div class="ecp-row">
          <span class="ecp-icon">${meta.icon}</span>
          <div class="ecp-info">
            <span class="ecp-name">${escapeHtml(meta.name)}</span>
            ${cagr !== null ? `<span class="ecp-cagr" style="color:${cagrColor}">CAGR: ${cagr > 0 ? '+' : ''}${cagr.toFixed(1)}%/yr</span>` : ''}
          </div>
          <div class="ecp-spark-wrap">${trendLine(s.data)}</div>
          <div class="ecp-cap-col">
            <div class="ecp-bar-track">
              <div class="ecp-bar-fill" style="width:${barPct.toFixed(1)}%;background:${meta.color}"></div>
            </div>
            <span class="ecp-cap">${latest ? fmtMW(latest.capacityMw) : 'N/A'}</span>
          </div>
        </div>`;
    }).join('');

    const content = `
      <div class="ecp-container">
        <div class="ecp-toolbar">${vBar}</div>
        <div class="ecp-summary">
          Renewables: <span class="ecp-renew-pct">${renewShare.toFixed(1)}%</span> of global capacity
        </div>
        <div class="ecp-list">${rows}</div>
        <div class="yc-footer">IEA Energy Capacity · ${YEARS}y history</div>
      </div>`;

    this.setContent(content);
    this.element?.querySelectorAll('.ecp-view-btn').forEach(btn =>
      btn.addEventListener('click', e => {
        const v = (e.currentTarget as HTMLElement).dataset['view'] as ViewFilter;
        if (v) { this.view = v; this.renderPanel(); }
      }),
    );
  }
}
