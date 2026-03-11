import { Panel } from './Panel';
import { t } from '@/services/i18n';
import { escapeHtml } from '@/utils/sanitize';
import { EconomicServiceClient } from '@/generated/client/worldmonitor/economic/v1/service_client';
import type {
  GetMacroSignalsResponse,
  MacroSignals,
  FearGreedHistoryEntry,
} from '@/generated/client/worldmonitor/economic/v1/service_client';

const economicClient = new EconomicServiceClient('', { fetch: (...args) => globalThis.fetch(...args) });

function signalDot(status: string): string {
  const s = status?.toLowerCase() ?? '';
  if (s.includes('bull') || s.includes('risk-on') || s.includes('positive') || s.includes('uptrend') || s.includes('high'))
    return '<span class="mrp-dot mrp-bull">●</span>';
  if (s.includes('bear') || s.includes('risk-off') || s.includes('negative') || s.includes('downtrend') || s.includes('low'))
    return '<span class="mrp-dot mrp-bear">●</span>';
  if (s.includes('neutral') || s.includes('mixed') || s.includes('sideways'))
    return '<span class="mrp-dot mrp-neutral">●</span>';
  return '<span class="mrp-dot mrp-dim">●</span>';
}

function verdictClass(verdict: string): string {
  const v = verdict?.toLowerCase() ?? '';
  if (v.includes('bull') || v.includes('risk-on') || v.includes('positive')) return 'mrp-verdict-bull';
  if (v.includes('bear') || v.includes('risk-off') || v.includes('negative')) return 'mrp-verdict-bear';
  return 'mrp-verdict-neutral';
}

function fearGreedGauge(value: number): string {
  // 0-25 extreme fear, 26-45 fear, 46-55 neutral, 56-75 greed, 76-100 extreme greed
  const pct = Math.min(100, Math.max(0, value));
  let label: string, color: string;
  if (pct <= 25)      { label = 'Extreme Fear'; color = '#f44336'; }
  else if (pct <= 45) { label = 'Fear'; color = '#ff9800'; }
  else if (pct <= 55) { label = 'Neutral'; color = '#90a4ae'; }
  else if (pct <= 75) { label = 'Greed'; color = '#8bc34a'; }
  else                { label = 'Extreme Greed'; color = '#4caf50'; }

  return `<div class="mrp-fg-wrap">
    <div class="mrp-fg-bar-track">
      <div class="mrp-fg-bar-fill" style="width:${pct}%;background:${color}"></div>
    </div>
    <div class="mrp-fg-labels">
      <span style="font-size:.55rem;color:#f44336">Fear</span>
      <span class="mrp-fg-val" style="color:${color}">${Math.round(pct)} · ${label}</span>
      <span style="font-size:.55rem;color:#4caf50">Greed</span>
    </div>
  </div>`;
}

function miniHistoryLine(history: FearGreedHistoryEntry[], width = 120, height = 24): string {
  if (!history || history.length < 2) return '';
  const vals = history.map(h => h.value);
  const min = Math.min(...vals), max = Math.max(...vals);
  const rng = max - min || 1;
  const pts = vals.map((v, i) => {
    const x = (i / (vals.length - 1)) * width;
    const y = height - ((v - min) / rng) * (height - 2) - 1;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const last = vals[vals.length - 1]!;
  const color = last > 55 ? '#4caf50' : last < 45 ? '#f44336' : '#90a4ae';
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" class="mrp-hist-spark"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

interface SignalRow { label: string; status: string; detail?: string }

function buildSignalRows(signals: MacroSignals): SignalRow[] {
  const rows: SignalRow[] = [];
  if (signals.liquidity) {
    rows.push({
      label: 'Liquidity',
      status: signals.liquidity.status,
      detail: signals.liquidity.value != null ? `M2 proxy: ${signals.liquidity.value.toFixed(1)}%` : undefined,
    });
  }
  if (signals.macroRegime) {
    rows.push({
      label: 'Macro Regime',
      status: signals.macroRegime.status,
      detail: signals.macroRegime.qqqRoc20 != null ? `QQQ 20d: ${signals.macroRegime.qqqRoc20 > 0 ? '+' : ''}${signals.macroRegime.qqqRoc20.toFixed(1)}%` : undefined,
    });
  }
  if (signals.flowStructure) {
    const btc = signals.flowStructure.btcReturn5;
    const qqq = signals.flowStructure.qqqReturn5;
    rows.push({
      label: 'Flow Structure',
      status: signals.flowStructure.status,
      detail: btc != null && qqq != null ? `BTC: ${btc > 0 ? '+' : ''}${btc.toFixed(1)}% · QQQ: ${qqq > 0 ? '+' : ''}${qqq.toFixed(1)}%` : undefined,
    });
  }
  if (signals.technicalTrend) {
    rows.push({
      label: 'Technical Trend',
      status: signals.technicalTrend.status,
      detail: signals.technicalTrend.btcPrice != null ? `BTC: $${signals.technicalTrend.btcPrice.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : undefined,
    });
  }
  if (signals.hashRate) {
    rows.push({
      label: 'Hash Rate',
      status: (signals.hashRate as { status: string }).status,
    });
  }
  if (signals.priceMomentum) {
    rows.push({
      label: 'Price Momentum',
      status: (signals.priceMomentum as { status: string }).status,
    });
  }
  return rows;
}

export class MacroRegimePanel extends Panel {
  private data: GetMacroSignalsResponse | null = null;
  private loading = true;
  private error: string | null = null;

  constructor() {
    super({ id: 'macro-regime', title: t('panels.macroRegime'), showCount: false });
    void this.fetchData();
  }

  public async fetchData(): Promise<void> {
    this.loading = true;
    this.error = null;
    this.renderPanel();
    try {
      this.data = await economicClient.getMacroSignals({});
      this.loading = false;
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to load macro signals';
      this.loading = false;
    }
    if (!this.element?.isConnected) return;
    this.renderPanel();
    setTimeout(() => { if (this.element?.isConnected) void this.fetchData(); }, 15 * 60 * 1000);
  }

  protected renderPanel(): void {
    if (this.loading) { this.showLoading(); return; }
    if (this.error || !this.data) { this.showError(this.error ?? 'No macro data'); return; }
    if (this.data.unavailable) { this.showError('Macro signals unavailable'); return; }

    const { verdict, bullishCount, totalCount, signals, meta } = this.data;
    const score = totalCount > 0 ? Math.round((bullishCount / totalCount) * 100) : 0;
    const vClass = verdictClass(verdict);

    const signalRows = signals ? buildSignalRows(signals) : [];
    const fg = signals?.fearGreed;
    const fgValue = fg?.value ?? null;

    const rowsHtml = signalRows.map(row => `
      <div class="mrp-signal-row">
        ${signalDot(row.status)}
        <div class="mrp-signal-info">
          <span class="mrp-signal-label">${escapeHtml(row.label)}</span>
          ${row.detail ? `<span class="mrp-signal-detail">${escapeHtml(row.detail)}</span>` : ''}
        </div>
        <span class="mrp-signal-status">${escapeHtml(row.status)}</span>
      </div>`).join('');

    const fgSection = fgValue != null ? `
      <div class="mrp-section-title">Fear & Greed Index</div>
      ${fearGreedGauge(fgValue)}
      ${fg?.history?.length ? `<div class="mrp-fg-hist">${miniHistoryLine(fg.history)}</div>` : ''}
    ` : '';

    const qqqSparkHtml = meta?.qqqSparkline?.length
      ? `<div class="mrp-qqq-row">
          <span class="mrp-qqq-lbl">QQQ trend</span>
          ${miniHistoryLine(meta.qqqSparkline.map(v => ({ value: v, date: '' })), 80, 20)}
        </div>`
      : '';

    const content = `
      <div class="mrp-container">
        <div class="mrp-verdict-row">
          <span class="mrp-verdict ${vClass}">${escapeHtml(verdict)}</span>
          <span class="mrp-score">${bullishCount}/${totalCount} bullish</span>
          <div class="mrp-score-bar-track">
            <div class="mrp-score-bar-fill" style="width:${score}%"></div>
          </div>
        </div>
        ${qqqSparkHtml}
        <div class="mrp-section-title">Component Signals</div>
        <div class="mrp-signals">${rowsHtml}</div>
        ${fgSection}
        <div class="yc-footer">Macro Signals · ${this.data.timestamp ? new Date(this.data.timestamp).toLocaleDateString() : ''}</div>
      </div>`;

    this.setContent(content);
  }
}
