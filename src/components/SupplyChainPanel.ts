import { Panel } from './Panel';
import type {
  GetShippingRatesResponse,
  GetChokepointStatusResponse,
  GetCriticalMineralsResponse,
  GetShippingStressResponse,
} from '@/services/supply-chain';
import { TransitChart } from '@/utils/transit-chart';
import { t } from '@/services/i18n';
import { escapeHtml } from '@/utils/sanitize';
import { isFeatureAvailable } from '@/services/runtime-config';
import { isDesktopRuntime } from '@/services/runtime';

type TabId = 'chokepoints' | 'shipping' | 'indicators' | 'minerals' | 'stress';

export class SupplyChainPanel extends Panel {
  private shippingData: GetShippingRatesResponse | null = null;
  private chokepointData: GetChokepointStatusResponse | null = null;
  private mineralsData: GetCriticalMineralsResponse | null = null;
  private stressData: GetShippingStressResponse | null = null;
  private activeTab: TabId = 'chokepoints';
  private expandedChokepoint: string | null = null;
  private transitChart = new TransitChart();
  private chartObserver: MutationObserver | null = null;

  constructor() {
    super({ id: 'supply-chain', title: t('panels.supplyChain'), defaultRowSpan: 2, infoTooltip: t('components.supplyChain.infoTooltip') });
    this.content.addEventListener('click', (e) => {
      const tab = (e.target as HTMLElement).closest('.panel-tab') as HTMLElement | null;
      if (tab) {
        const tabId = tab.dataset.tab as TabId;
        if (tabId && tabId !== this.activeTab) {
          this.clearTransitChart();
          this.activeTab = tabId;
          this.render();
        }
        return;
      }
      const card = (e.target as HTMLElement).closest('.trade-restriction-card') as HTMLElement | null;
      if (card?.dataset.cpId) {
        const newId = this.expandedChokepoint === card.dataset.cpId ? null : card.dataset.cpId;
        if (!newId) this.clearTransitChart();
        this.expandedChokepoint = newId;
        this.render();
      }
    });
  }

  private clearTransitChart(): void {
    if (this.chartObserver) { this.chartObserver.disconnect(); this.chartObserver = null; }
    this.transitChart.destroy();
  }

  public updateShippingRates(data: GetShippingRatesResponse): void {
    this.shippingData = data;
    this.render();
  }

  public updateChokepointStatus(data: GetChokepointStatusResponse): void {
    this.chokepointData = data;
    this.render();
  }

  public updateCriticalMinerals(data: GetCriticalMineralsResponse): void {
    this.mineralsData = data;
    this.render();
  }

  public updateShippingStress(data: GetShippingStressResponse): void {
    this.stressData = data;
    this.render();
  }

  private render(): void {
    this.clearTransitChart();

    const tabsHtml = `
      <div class="panel-tabs">
        <button class="panel-tab ${this.activeTab === 'chokepoints' ? 'active' : ''}" data-tab="chokepoints">
          ${t('components.supplyChain.chokepoints')}
        </button>
        <button class="panel-tab ${this.activeTab === 'shipping' ? 'active' : ''}" data-tab="shipping">
          ${t('components.supplyChain.shipping')}
        </button>
        <button class="panel-tab ${this.activeTab === 'minerals' ? 'active' : ''}" data-tab="minerals">
          ${t('components.supplyChain.minerals')}
        </button>
        <button class="panel-tab ${this.activeTab === 'stress' ? 'active' : ''}" data-tab="stress">
          Stress
        </button>
      </div>
    `;

    const activeHasData = this.activeTab === 'chokepoints'
      ? (this.chokepointData?.chokepoints?.length ?? 0) > 0
      : this.activeTab === 'shipping'
        ? (this.shippingData?.indices?.length ?? 0) > 0 || this.chokepointData !== null
        : this.activeTab === 'indicators'
          ? (this.shippingData?.indices?.length ?? 0) > 0
          : this.activeTab === 'stress'
            ? (this.stressData?.carriers?.length ?? 0) > 0
            : (this.mineralsData?.minerals?.length ?? 0) > 0;
    const activeData = this.activeTab === 'chokepoints' ? this.chokepointData
      : (this.activeTab === 'shipping' || this.activeTab === 'indicators') ? this.shippingData
      : this.activeTab === 'stress' ? this.stressData
      : this.mineralsData;
    const unavailableBanner = !activeHasData && activeData?.upstreamUnavailable
      ? `<div class="economic-warning">${t('components.supplyChain.upstreamUnavailable')}</div>`
      : '';

    let contentHtml = '';
    switch (this.activeTab) {
      case 'chokepoints': contentHtml = this.renderChokepoints(); break;
      case 'shipping': contentHtml = this.renderShipping(); break;
      case 'minerals': contentHtml = this.renderMinerals(); break;
      case 'stress': contentHtml = this.renderStress(); break;
    }

    this.setContent(`
      ${tabsHtml}
      ${unavailableBanner}
      <div class="economic-content">${contentHtml}</div>
    `);

    if (this.activeTab === 'chokepoints' && this.expandedChokepoint) {
      this.chartObserver = new MutationObserver(() => {
        this.chartObserver?.disconnect();
        this.chartObserver = null;
        const el = this.content.querySelector(`[data-chart-cp="${this.expandedChokepoint}"]`) as HTMLElement | null;
        if (!el) return;
        const cp = this.chokepointData?.chokepoints?.find(c => c.name === this.expandedChokepoint);
        if (cp?.transitSummary?.history?.length) {
          this.transitChart.mount(el, cp.transitSummary.history);
        }
      });
      this.chartObserver.observe(this.content, { childList: true, subtree: true });
    }
  }

  private renderChokepoints(): string {
    if (!this.chokepointData || !this.chokepointData.chokepoints?.length) {
      return `<div class="economic-empty">${t('components.supplyChain.noChokepoints')}</div>`;
    }

    return `<div class="trade-restrictions-list">
      ${[...this.chokepointData.chokepoints].sort((a, b) => b.disruptionScore - a.disruptionScore).map(cp => {
        const statusClass = cp.status === 'red' ? 'status-active' : cp.status === 'yellow' ? 'status-notified' : 'status-terminated';
        const statusDot = cp.status === 'red' ? 'sc-dot-red' : cp.status === 'yellow' ? 'sc-dot-yellow' : 'sc-dot-green';
        const aisDisruptions = cp.aisDisruptions ?? (cp.congestionLevel === 'normal' ? 0 : 1);
        const ts = cp.transitSummary;
        const transitRow = ts && ts.todayTotal > 0
          ? `<div class="trade-sector">${t('components.supplyChain.transit24h')}: ${ts.todayTotal} vessels (${ts.todayTanker} ${t('components.supplyChain.tankers')}, ${ts.todayCargo} ${t('components.supplyChain.cargo')}, ${ts.todayOther} other) | ${t('components.supplyChain.wowChange')}: <span class="trade-flow-change ${ts.wowChangePct >= 0 ? 'change-positive' : 'change-negative'}">${ts.wowChangePct >= 0 ? '\u25B2' : '\u25BC'}${Math.abs(ts.wowChangePct).toFixed(1)}%</span></div>`
          : '';
        const riskRow = ts?.riskLevel
          ? `<div class="trade-sector">${t('components.supplyChain.riskLevel')}: ${escapeHtml(ts.riskLevel)} | ${ts.incidentCount7d} incidents (7d)</div>`
          : '';
        const expanded = this.expandedChokepoint === cp.name;
        const chartPlaceholder = expanded && ts?.history?.length
          ? `<div data-chart-cp="${escapeHtml(cp.name)}" style="margin-top:8px;min-height:200px"></div>`
          : '';
        return `<div class="trade-restriction-card${expanded ? ' expanded' : ''}" data-cp-id="${escapeHtml(cp.name)}" style="cursor:pointer">
          <div class="trade-restriction-header">
            <span class="trade-country">${escapeHtml(cp.name)}</span>
            <span class="sc-status-dot ${statusDot}"></span>
            <span class="trade-badge">${cp.disruptionScore}/100</span>
            <span class="trade-status ${statusClass}">${escapeHtml(cp.status)}</span>
          </div>
          <div class="trade-restriction-body">
            <div class="sc-metric-row">
              <span>${cp.activeWarnings} ${t('components.supplyChain.warnings')} · ${aisDisruptions} ${t('components.supplyChain.aisDisruptions')}</span>
              ${cp.directions?.length ? `<span>${cp.directions.map(d => escapeHtml(d)).join('/')}</span>` : ''}
            </div>
            ${ts && (ts.todayTotal > 0 || hasWow || disruptPct > 0) ? `<div class="sc-metric-row">
              ${ts.todayTotal > 0 ? `<span>${ts.todayTotal} ${t('components.supplyChain.vessels')}</span>` : ''}
              ${hasWow ? `<span>${t('components.supplyChain.wowChange')}: ${wowSpan}</span>` : ''}
              ${disruptPct > 0 ? `<span>${t('components.supplyChain.disruption')}: <span class="${disruptClass}">${disruptPct.toFixed(1)}%</span></span>` : ''}
            </div>` : ''}
            ${ts?.riskLevel ? `<div class="sc-metric-row">
              <span>${t('components.supplyChain.riskLevel')}: <span class="${riskClass}">${escapeHtml(ts.riskLevel)}</span></span>
              <span>${ts.incidentCount7d} ${t('components.supplyChain.incidents7d')}</span>
            </div>` : ''}
            ${cp.flowEstimate ? (() => {
              const fe = cp.flowEstimate;
              const pct = Math.round(fe.flowRatio * 100);
              const flowColor = fe.disrupted || pct < 85 ? '#ef4444' : pct < 95 ? '#f59e0b' : 'var(--text-dim,#888)';
              const hazardBadge = fe.hazardAlertLevel && fe.hazardAlertName
                ? ` <span style="background:#ea580c;color:#fff;font-size:9px;padding:1px 5px;border-radius:3px;margin-left:4px">&#9888; ${escapeHtml(fe.hazardAlertName.toUpperCase())}</span>`
                : '';
              return `<div class="sc-metric-row" style="color:${flowColor}">
                <span>~${fe.currentMbd} mb/d <span style="opacity:0.7">(${pct}% of ${fe.baselineMbd} baseline)</span>${hazardBadge}</span>
              </div>`;
            })() : ''}
            ${cp.description ? `<div class="trade-description">${escapeHtml(cp.description)}</div>` : ''}
            <div class="trade-affected">${cp.affectedRoutes.slice(0, 3).map(r => escapeHtml(r)).join(', ')}</div>
            ${actionRow}
            ${chartPlaceholder}
          </div>
        </div>`;
      }).join('')}
    </div>`;
  }

  private renderShipping(): string {
    if (isDesktopRuntime() && !isFeatureAvailable('supplyChain')) {
      return `<div class="economic-empty">${t('components.supplyChain.fredKeyMissing')}</div>`;
    }

    if (!this.shippingData || !this.shippingData.indices?.length) {
      return `<div class="economic-empty">${t('components.supplyChain.noShipping')}</div>`;
    }

    return `<div class="trade-restrictions-list">
      ${this.shippingData.indices.map(idx => {
        const changeClass = idx.changePct >= 0 ? 'change-positive' : 'change-negative';
        const changeArrow = idx.changePct >= 0 ? '\u25B2' : '\u25BC';
        const sparkline = this.renderSparkline(idx.history.map(h => h.value));
        const spikeBanner = idx.spikeAlert
          ? `<div class="economic-warning">${t('components.supplyChain.spikeAlert')}</div>`
          : '';
        return `<div class="trade-restriction-card">
          ${spikeBanner}
          <div class="trade-restriction-header">
            <span class="trade-country">${escapeHtml(idx.name)}</span>
            <span class="trade-badge">${idx.currentValue.toFixed(0)} ${escapeHtml(idx.unit)}</span>
            <span class="trade-flow-change ${changeClass}">${changeArrow} ${Math.abs(idx.changePct).toFixed(1)}%</span>
          </div>
          <div class="trade-restriction-body">
            ${sparkline}
          </div>
        </div>`;
      }).join('')}
    </div>`;
  }

  private renderIndicators(): string {
    if (isDesktopRuntime() && !isFeatureAvailable('supplyChain')) return '';
    if (!this.shippingData?.indices?.length) {
      return `<div class="economic-empty">${t('components.supplyChain.noShipping')}</div>`;
    }
    const container = new Set(['SCFI', 'CCFI']);
    const bulk = new Set(['BDI', 'BCI', 'BPI', 'BSI', 'BHSI']);
    const econIndices = this.shippingData.indices.filter(i => !container.has(i.indexId) && !bulk.has(i.indexId));
    if (!econIndices.length) {
      return `<div class="economic-empty">${t('components.supplyChain.noShipping')}</div>`;
    }
    const cards = econIndices.map(idx => {
      const changeClass = idx.changePct >= 0 ? 'change-positive' : 'change-negative';
      const changeArrow = idx.changePct >= 0 ? '\u25B2' : '\u25BC';
      const sparkline = this.renderSparkline(idx.history.map(h => h.value), idx.history.map(h => h.date));
      const spikeBanner = idx.spikeAlert
        ? `<div class="economic-warning">${t('components.supplyChain.spikeAlert')}</div>`
        : '';
      return `<div class="trade-restriction-card">
          ${spikeBanner}
          <div class="trade-restriction-header">
            <span class="trade-country">${escapeHtml(idx.name)}</span>
            <span class="trade-badge">${idx.currentValue.toFixed(0)} ${escapeHtml(idx.unit)}</span>
            <span class="trade-flow-change ${changeClass}">${changeArrow} ${Math.abs(idx.changePct).toFixed(1)}%</span>
          </div>
          <div class="trade-restriction-body">
            ${sparkline}
          </div>
        </div>`;
    }).join('');
    return `<div class="trade-restrictions-list">${cards}</div>`;
  }

  private renderStress(): string {
    if (!this.stressData || !this.stressData.carriers?.length) {
      return `<div class="economic-empty">Shipping stress data unavailable</div>`;
    }

    const { stressScore, stressLevel, carriers } = this.stressData;
    const levelColor = stressLevel === 'critical' ? '#e74c3c'
      : stressLevel === 'elevated' ? '#e67e22'
      : stressLevel === 'moderate' ? '#f1c40f'
      : '#27ae60';

    const gaugeWidth = Math.round(Math.min(100, Math.max(0, stressScore)));
    const gaugeBg = stressLevel === 'critical' ? 'rgba(231,76,60,0.15)'
      : stressLevel === 'elevated' ? 'rgba(230,126,34,0.15)'
      : stressLevel === 'moderate' ? 'rgba(241,196,15,0.15)'
      : 'rgba(39,174,96,0.15)';

    const header = `<div style="margin-bottom:12px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
        <span style="font-size:11px;color:var(--text-dim);text-transform:uppercase;letter-spacing:0.06em">Composite Stress Score</span>
        <span style="font-size:11px;font-weight:700;padding:2px 7px;border-radius:3px;background:${gaugeBg};color:${levelColor}">${escapeHtml(stressLevel.toUpperCase())}</span>
      </div>
      <div style="position:relative;height:6px;border-radius:3px;background:rgba(255,255,255,0.08)">
        <div style="position:absolute;left:0;top:0;height:100%;width:${gaugeWidth}%;border-radius:3px;background:${levelColor};transition:width 0.4s"></div>
      </div>
      <div style="text-align:right;font-size:10px;color:var(--text-dim);margin-top:2px">${stressScore.toFixed(1)}/100</div>
    </div>`;

    const rows = carriers.map(c => {
      const changeClass = c.changePct >= 0 ? 'change-positive' : 'change-negative';
      const arrow = c.changePct >= 0 ? '▲' : '▼';
      const typeLabel = c.carrierType === 'etf' ? 'ETF' : c.carrierType === 'index' ? 'IDX' : 'CARR';
      const spark = c.sparkline?.length >= 2 ? this.renderSparkline(c.sparkline) : '';
      return `<div class="trade-restriction-card">
        <div class="trade-restriction-header">
          <span class="trade-country" style="font-size:11px">${escapeHtml(c.symbol)}</span>
          <span style="font-size:9px;padding:1px 5px;border-radius:2px;background:rgba(255,255,255,0.06);color:var(--text-dim)">${typeLabel}</span>
          <span class="trade-badge">${c.price.toFixed(2)}</span>
          <span class="trade-flow-change ${changeClass}">${arrow} ${Math.abs(c.changePct).toFixed(2)}%</span>
        </div>
        <div class="trade-restriction-body" style="font-size:10px;color:var(--text-dim)">${escapeHtml(c.name)}${spark}</div>
      </div>`;
    }).join('');

    return `<div class="trade-restrictions-list">${header}${rows}</div>`;
  }

  private renderSparkline(values: number[], dates?: string[]): string {
    if (values.length < 2) return '';
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const w = 200;
    const h = 40;
    const points = values.map((v, i) => {
      const x = (i / (values.length - 1)) * w;
      const y = h - ((v - min) / range) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');

    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="display:block;margin:4px 0">
      <polyline points="${points}" fill="none" stroke="var(--accent-primary, #4fc3f7)" stroke-width="1.5" />
    </svg>`;
  }

  private renderMinerals(): string {
    if (!this.mineralsData || !this.mineralsData.minerals?.length) {
      return `<div class="economic-empty">${t('components.supplyChain.noMinerals')}</div>`;
    }

    const rows = this.mineralsData.minerals.map(m => {
      const riskClass = m.riskRating === 'critical' ? 'sc-risk-critical'
        : m.riskRating === 'high' ? 'sc-risk-high'
        : m.riskRating === 'moderate' ? 'sc-risk-moderate'
        : 'sc-risk-low';
      const top3 = m.topProducers.slice(0, 3).map(p =>
        `${escapeHtml(p.country)} ${p.sharePct.toFixed(0)}%`
      ).join(', ');
      return `<tr>
        <td>${escapeHtml(m.mineral)}</td>
        <td>${top3}</td>
        <td>${m.hhi.toFixed(0)}</td>
        <td><span class="${riskClass}">${escapeHtml(m.riskRating)}</span></td>
      </tr>`;
    }).join('');

    return `<div class="trade-tariffs-table">
      <table>
        <thead>
          <tr>
            <th>${t('components.supplyChain.mineral')}</th>
            <th>${t('components.supplyChain.topProducers')}</th>
            <th>HHI</th>
            <th>${t('components.supplyChain.risk')}</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  }
}
