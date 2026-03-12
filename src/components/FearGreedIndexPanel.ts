import { Panel } from './Panel';
import { t } from '@/services/i18n';
import { escapeHtml } from '@/utils/sanitize';
import { EconomicServiceClient } from '@/generated/client/worldmonitor/economic/v1/service_client';
import type { FredSeries } from '@/generated/client/worldmonitor/economic/v1/service_client';
import { recordSentimentScore, getSentimentTrend, type SentimentTrend } from '@/services/sentiment-trend';

const econClient = new EconomicServiceClient('', { fetch: (...args) => globalThis.fetch(...args) });

// Composite Fear & Greed gauge built from 7 market indicators via FRED
interface Indicator {
  id: string;
  label: string;
  weight: number;
  // Normalisation: maps raw value → 0-100 (0 = extreme fear, 100 = extreme greed)
  normalize: (v: number) => number;
}

const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));

const INDICATORS: Indicator[] = [
  { id: 'VIXCLS',       label: 'Market Volatility (VIX)',  weight: 0.20, normalize: v => clamp(100 - ((v - 12) / 38) * 100) },
  { id: 'T10Y2Y',       label: 'Yield Curve Spread',       weight: 0.12, normalize: v => clamp(((v + 1) / 3) * 100) },
  { id: 'BAA10Y',       label: 'Junk Bond Demand',         weight: 0.15, normalize: v => clamp(100 - ((v - 1.5) / 4) * 100) },
  { id: 'SP500',        label: 'S&P 500 Momentum',         weight: 0.15, normalize: v => clamp(v > 0 ? 50 + v * 5 : 50 + v * 5) },
  { id: 'BAMLH0A0HYM2', label: 'High Yield Spread',       weight: 0.12, normalize: v => clamp(100 - ((v - 3) / 6) * 100) },
  { id: 'NFCI',         label: 'Financial Conditions',     weight: 0.14, normalize: v => clamp(50 - v * 50) },
  { id: 'TEDRATE',      label: 'Safe Haven Demand (TED)',  weight: 0.12, normalize: v => clamp(100 - (v / 1.5) * 100) },
];

function sentimentLabel(score: number): { text: string; color: string } {
  if (score <= 20) return { text: 'Extreme Fear', color: '#d32f2f' };
  if (score <= 40) return { text: 'Fear', color: '#f44336' };
  if (score <= 60) return { text: 'Neutral', color: '#ffc107' };
  if (score <= 80) return { text: 'Greed', color: '#66bb6a' };
  return { text: 'Extreme Greed', color: '#2e7d32' };
}

function gaugeArc(score: number, size = 180): string {
  // SVG arc from -135° to 135° (270° sweep)
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 12;
  const startAngle = -135;
  const endAngle = startAngle + (score / 100) * 270;
  const startRad = (startAngle * Math.PI) / 180;
  const endRad = (endAngle * Math.PI) / 180;
  const x1 = cx + r * Math.cos(startRad);
  const y1 = cy + r * Math.sin(startRad);
  const x2 = cx + r * Math.cos(endRad);
  const y2 = cy + r * Math.sin(endRad);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  const { color } = sentimentLabel(score);

  // Background track
  const bgEndRad = ((startAngle + 270) * Math.PI) / 180;
  const bx2 = cx + r * Math.cos(bgEndRad);
  const by2 = cy + r * Math.sin(bgEndRad);

  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" class="fg-gauge">
    <path d="M ${x1},${y1} A ${r},${r} 0 1 1 ${bx2},${by2}" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="10" stroke-linecap="round"/>
    <path d="M ${x1},${y1} A ${r},${r} 0 ${largeArc} 1 ${x2},${y2}" fill="none" stroke="${color}" stroke-width="10" stroke-linecap="round"/>
    <text x="${cx}" y="${cy - 8}" text-anchor="middle" fill="${color}" font-size="32" font-weight="bold">${Math.round(score)}</text>
    <text x="${cx}" y="${cy + 16}" text-anchor="middle" fill="rgba(255,255,255,0.7)" font-size="12">${escapeHtml(sentimentLabel(score).text)}</text>
  </svg>`;
}

export class FearGreedIndexPanel extends Panel {
  private data: Map<string, FredSeries> = new Map();
  private loading = true;
  private error: string | null = null;
  private trend: SentimentTrend | null = null;

  constructor() {
    super({ id: 'fear-greed', title: t('panels.fearGreed') });
    void this.fetchData();
  }

  public async fetchData(): Promise<void> {
    this.loading = true;
    this.error = null;
    this.showLoading();
    try {
      const ids = INDICATORS.map(i => i.id);
      const res = await econClient.getFredSeriesBatch({ seriesIds: ids, limit: 30 });
      for (const [id, series] of Object.entries(res.results ?? {})) {
        this.data.set(id, series);
      }
      this.loading = false;
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to load sentiment data';
      this.loading = false;
    }
    // Record composite score for trend tracking (F-25)
    if (!this.error) {
      const { composite } = this.computeScore();
      recordSentimentScore(composite);
      this.trend = getSentimentTrend();
    }
    if (this.element?.isConnected) this.renderPanel();
    setTimeout(() => { if (this.element?.isConnected) void this.fetchData(); }, 15 * 60 * 1000);
  }

  private latest(id: string): number | null {
    const s = this.data.get(id);
    if (!s?.observations?.length) return null;
    const sorted = [...s.observations].sort((a, b) => b.date.localeCompare(a.date));
    return sorted[0]?.value ?? null;
  }

  private computeScore(): { composite: number; breakdown: Array<{ ind: Indicator; raw: number | null; norm: number }> } {
    let totalWeight = 0;
    let weighted = 0;
    const breakdown: Array<{ ind: Indicator; raw: number | null; norm: number }> = [];

    for (const ind of INDICATORS) {
      const raw = this.latest(ind.id);
      if (raw == null) {
        breakdown.push({ ind, raw: null, norm: 50 });
        continue;
      }
      const norm = ind.normalize(raw);
      breakdown.push({ ind, raw, norm });
      weighted += norm * ind.weight;
      totalWeight += ind.weight;
    }

    const composite = totalWeight > 0 ? weighted / totalWeight : 50;
    return { composite, breakdown };
  }

  private renderTrend(trend: SentimentTrend): string {
    const arrow = trend.direction === 'improving' ? '↗' : trend.direction === 'deteriorating' ? '↘' : '→';
    const dirColor = trend.direction === 'improving' ? '#66bb6a' : trend.direction === 'deteriorating' ? '#f44336' : '#ffc107';
    const regime = trend.regimeShift
      ? '<span style="color:#ff9800;font-weight:600;margin-left:6px">⚡ Regime shift</span>'
      : '';
    const smaText = trend.sma5 != null ? `SMA₅: ${trend.sma5.toFixed(1)}` : '';
    const sma20Text = trend.sma20 != null ? ` · SMA₂₀: ${trend.sma20.toFixed(1)}` : '';

    return `<div style="margin-top:6px;font-size:11px;color:rgba(255,255,255,0.6);display:flex;align-items:center;justify-content:center;gap:4px">
      <span style="color:${dirColor};font-size:14px">${arrow}</span>
      <span style="color:${dirColor};font-weight:600">${escapeHtml(trend.direction)}</span>
      <span style="opacity:0.5">(${trend.momentum > 0 ? '+' : ''}${trend.momentum}/hr)</span>
      ${regime}
    </div>
    ${smaText ? `<div style="font-size:10px;color:rgba(255,255,255,0.4);text-align:center;margin-top:2px">${escapeHtml(smaText + sma20Text)}</div>` : ''}`;
  }

  protected renderPanel(): void {
    if (this.loading) { this.showLoading(); return; }
    if (this.error) { this.showError(this.error); return; }

    const { composite, breakdown } = this.computeScore();
    const { text: label, color } = sentimentLabel(composite);

    const rows = breakdown.map(({ ind, raw, norm }) => {
      const bg = norm <= 30 ? 'rgba(244,67,54,0.15)' : norm >= 70 ? 'rgba(102,187,106,0.15)' : 'rgba(255,193,7,0.08)';
      const barColor = norm <= 30 ? '#f44336' : norm >= 70 ? '#66bb6a' : '#ffc107';
      return `<div class="fg-row" style="background:${bg};border-radius:6px;padding:6px 10px;margin-bottom:4px;display:flex;align-items:center;gap:8px">
        <div style="flex:1;min-width:0">
          <div style="font-size:12px;color:rgba(255,255,255,0.85)">${escapeHtml(ind.label)}</div>
          <div style="font-size:11px;color:rgba(255,255,255,0.5)">${raw != null ? raw.toFixed(2) : 'N/A'}</div>
        </div>
        <div style="width:60px;height:6px;background:rgba(255,255,255,0.08);border-radius:3px;overflow:hidden">
          <div style="width:${norm}%;height:100%;background:${barColor};border-radius:3px"></div>
        </div>
        <div style="width:28px;text-align:right;font-size:12px;font-weight:600;color:${barColor}">${Math.round(norm)}</div>
      </div>`;
    }).join('');

    const trendHtml = this.trend ? this.renderTrend(this.trend) : '';

    const html = `
      <div class="fg-panel" style="text-align:center;">
        ${gaugeArc(composite)}
        <div style="margin:8px 0 4px;font-size:13px;color:rgba(255,255,255,0.6)">
          Composite Sentiment: <strong style="color:${color}">${label}</strong>
        </div>
        ${trendHtml}
      </div>
      <div class="fg-breakdown" style="margin-top:12px">
        <div style="font-size:11px;color:rgba(255,255,255,0.5);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.5px">Components</div>
        ${rows}
        <div style="font-size:10px;color:rgba(255,255,255,0.35);margin-top:8px;text-align:center">
          Based on 7 market indicators via FRED • Updated every 15 min
        </div>
      </div>`;

    this.setContent(html);
  }
}
