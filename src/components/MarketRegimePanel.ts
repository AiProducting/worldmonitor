import { Panel } from './Panel';
import { t } from '@/services/i18n';
import { escapeHtml } from '@/utils/sanitize';
import { EconomicServiceClient } from '@/generated/client/worldmonitor/economic/v1/service_client';
import { MarketServiceClient } from '@/generated/client/worldmonitor/market/v1/service_client';
import type { FredSeries } from '@/generated/client/worldmonitor/economic/v1/service_client';
import { classifyMarketRegime, type RegimeClassification, type RegimeInput } from '@/services/market-regime';

const econClient = new EconomicServiceClient('', { fetch: (...args) => globalThis.fetch(...args) });
const marketClient = new MarketServiceClient('', { fetch: (...args) => globalThis.fetch(...args) });

// FRED series needed for regime classification
const REGIME_SERIES = ['VIXCLS', 'T10Y2Y', 'T10Y3M', 'NFCI', 'SP500', 'BAMLH0A0HYM2'];

interface RegimeDisplayInfo {
  label: string;
  icon: string;
  color: string;
  bgColor: string;
  description: string;
}

const REGIME_DISPLAY: Record<string, RegimeDisplayInfo> = {
  'risk-on':        { label: 'Risk-On',       icon: '🟢', color: '#22c55e', bgColor: '#22c55e15', description: 'Bullish conditions — equities favored, credit tightening' },
  'risk-off':       { label: 'Risk-Off',      icon: '🔴', color: '#ef4444', bgColor: '#ef444415', description: 'Defensive posture — bonds, gold, cash favored' },
  'euphoria':       { label: 'Euphoria',      icon: '🚀', color: '#a855f7', bgColor: '#a855f715', description: 'Extreme optimism — caution warranted, potential top' },
  'panic':          { label: 'Panic',         icon: '🔥', color: '#dc2626', bgColor: '#dc262615', description: 'Extreme fear — capitulation phase, potential bottom' },
  'recovery':       { label: 'Recovery',      icon: '🌅', color: '#3b82f6', bgColor: '#3b82f615', description: 'Improving conditions — transitioning from risk-off' },
  'deterioration':  { label: 'Deterioration', icon: '⚠️', color: '#f59e0b', bgColor: '#f59e0b15', description: 'Worsening conditions — transitioning to risk-off' },
  'neutral':        { label: 'Neutral',       icon: '⚖️', color: '#64748b', bgColor: '#64748b15', description: 'Mixed signals — no dominant regime' },
};

function confidenceColor(c: number): string {
  if (c >= 75) return '#22c55e';
  if (c >= 50) return '#fbbf24';
  return '#f97316';
}

function componentBar(weight: number, vote: string): string {
  const w = Math.round(weight * 100);
  const color = vote === 'risk-on' || vote === 'euphoria' || vote === 'recovery'
    ? '#22c55e'
    : vote === 'risk-off' || vote === 'panic'
      ? '#ef4444'
      : vote === 'deterioration'
        ? '#f59e0b'
        : '#64748b';
  return `<div class="mrp-comp-bar-track"><div class="mrp-comp-bar" style="width:${w}%;background:${color}"></div></div>`;
}

export class MarketRegimePanel extends Panel {
  private regime: RegimeClassification | null = null;
  private loading = true;
  private error: string | null = null;
  private history: { label: string; confidence: number; ts: number }[] = [];

  constructor() {
    super({ id: 'market-regime', title: t('panels.marketRegime') ?? 'Market Regime', showCount: false });
    void this.fetchData();
  }

  public async fetchData(): Promise<void> {
    this.loading = true;
    this.error = null;
    this.renderPanel();
    try {
      const [fredResp, sectorResp] = await Promise.all([
        econClient.getFredSeriesBatch({ seriesIds: REGIME_SERIES, limit: 30 }),
        marketClient.getSectorSummary({ period: '1D' }),
      ]);

      const results = fredResp.results ?? {};
      const latest = (id: string) => {
        const obs = results[id]?.observations;
        return obs?.length ? obs[obs.length - 1]!.value : 0;
      };

      const vix = latest('VIXCLS');
      const t10y2y = latest('T10Y2Y');
      const nfci = latest('NFCI');

      // Compute breadth from sector data
      const sectors = sectorResp.sectors ?? [];
      const advances = sectors.filter(s => s.change > 0).length;
      const declines = sectors.filter(s => s.change < 0).length;
      const adRatio = declines > 0 ? advances / declines : advances > 0 ? 10 : 1;

      // Determine vol term structure shape from VIX level
      const volTermShape: 'contango' | 'backwardation' | 'flat' =
        vix > 25 ? 'backwardation' : vix < 15 ? 'contango' : 'flat';

      // Sector rotation: cyclicals vs defensives
      const cyclicals = sectors.filter(s => ['XLY', 'XLI', 'XLB', 'XLK', 'XLF'].includes(s.symbol));
      const defensives = sectors.filter(s => ['XLU', 'XLP', 'XLV', 'XLRE'].includes(s.symbol));
      const cycAvg = cyclicals.reduce((a, s) => a + s.change, 0) / (cyclicals.length || 1);
      const defAvg = defensives.reduce((a, s) => a + s.change, 0) / (defensives.length || 1);
      const sectorRotation: 'cyclical' | 'defensive' | 'balanced' =
        cycAvg - defAvg > 0.5 ? 'cyclical' : defAvg - cycAvg > 0.5 ? 'defensive' : 'balanced';

      // Yield curve shape
      const curveShape: 'normal' | 'flat' | 'inverted' =
        t10y2y < -0.2 ? 'inverted' : t10y2y < 0.3 ? 'flat' : 'normal';

      const input: RegimeInput = {
        sentimentScore: Math.max(0, Math.min(100, 50 - vix + 30)),
        breadth: { adRatio, mcclellanOsc: (adRatio - 1) * 50 },
        volatility: { vix, volTermShape },
        sectorRotation,
        yieldCurveShape: curveShape,
      };

      this.regime = classifyMarketRegime(input);

      // Record to history
      this.history.push({
        label: this.regime.regime,
        confidence: this.regime.confidence,
        ts: Date.now(),
      });
      if (this.history.length > 48) this.history.shift(); // ~12h at 15min

      this.loading = false;
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to classify regime';
      this.loading = false;
    }
    if (!this.element?.isConnected) return;
    this.renderPanel();
    this.scheduleRefresh();
  }

  private scheduleRefresh(): void {
    setTimeout(() => { if (this.element?.isConnected) void this.fetchData(); }, 5 * 60 * 1000);
  }

  protected renderPanel(): void {
    if (this.loading) { this.showLoading(); return; }
    if (this.error || !this.regime) { this.showError(this.error ?? 'No data'); return; }

    const r = this.regime;
    const display = REGIME_DISPLAY[r.regime] ?? REGIME_DISPLAY['neutral']!;

    // Confidence gauge arc
    const gaugeSize = 120;
    const cx = gaugeSize / 2;
    const cy = gaugeSize / 2;
    const rad = gaugeSize / 2 - 8;
    const startAngle = -135;
    const endAngle = startAngle + (r.confidence / 100) * 270;
    const sr = (startAngle * Math.PI) / 180;
    const er = (endAngle * Math.PI) / 180;
    const x1 = cx + rad * Math.cos(sr);
    const y1 = cy + rad * Math.sin(sr);
    const x2 = cx + rad * Math.cos(er);
    const y2 = cy + rad * Math.sin(er);
    const largeArc = r.confidence > 50 ? 1 : 0;

    const gauge = `
      <svg class="mrp-gauge" width="${gaugeSize}" height="${gaugeSize}" viewBox="0 0 ${gaugeSize} ${gaugeSize}">
        <path d="M ${x1} ${y1} A ${rad} ${rad} 0 1 1 ${cx + rad * Math.cos((135 * Math.PI) / 180)} ${cy + rad * Math.sin((135 * Math.PI) / 180)}"
              fill="none" stroke="#1e293b" stroke-width="8" stroke-linecap="round"/>
        <path d="M ${x1} ${y1} A ${rad} ${rad} 0 ${largeArc} 1 ${x2} ${y2}"
              fill="none" stroke="${display.color}" stroke-width="8" stroke-linecap="round"/>
        <text x="${cx}" y="${cy - 6}" text-anchor="middle" fill="${display.color}" font-size="22" font-weight="800">${display.icon}</text>
        <text x="${cx}" y="${cy + 16}" text-anchor="middle" fill="${display.color}" font-size="13" font-weight="700">${display.label}</text>
        <text x="${cx}" y="${cy + 32}" text-anchor="middle" fill="${confidenceColor(r.confidence)}" font-size="11">${r.confidence}% conf</text>
      </svg>`;

    // Component breakdown
    const components = r.components.map(c => `
      <div class="mrp-comp">
        <span class="mrp-comp-name">${escapeHtml(c.name)}</span>
        ${componentBar(c.weight, c.vote)}
        <span class="mrp-comp-vote" style="color:${REGIME_DISPLAY[c.vote]?.color ?? '#64748b'}">${escapeHtml(c.vote)}</span>
      </div>
    `).join('');

    // Mini history timeline
    const timeline = this.history.slice(-12).map(h => {
      const d = REGIME_DISPLAY[h.label] ?? REGIME_DISPLAY['neutral']!;
      return `<div class="mrp-timeline-dot" style="background:${d.color}" title="${d.label} (${h.confidence}%)"></div>`;
    }).join('');

    const content = `
      <div class="mrp-container" style="background:${display.bgColor}">
        <div class="mrp-header">
          ${gauge}
          <div class="mrp-desc">
            <p class="mrp-desc-text">${escapeHtml(display.description)}</p>
          </div>
        </div>
        <div class="mrp-section-title">Signal Components</div>
        <div class="mrp-components">${components}</div>
        ${this.history.length > 1 ? `
          <div class="mrp-section-title">Regime History</div>
          <div class="mrp-timeline">${timeline}</div>
        ` : ''}
      </div>`;

    this.setContent(content);
  }
}
