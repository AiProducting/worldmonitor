import { Panel } from './Panel';
import { t } from '@/services/i18n';
import { escapeHtml } from '@/utils/sanitize';
import { EconomicServiceClient } from '@/generated/client/worldmonitor/economic/v1/service_client';
import type { FredSeries } from '@/generated/client/worldmonitor/economic/v1/service_client';

// FRED series IDs for US Treasury yields
const YIELD_SERIES: Array<{ id: string; label: string; tenor: number }> = [
  { id: 'DGS3MO', label: '3M', tenor: 0.25 },
  { id: 'DGS6MO', label: '6M', tenor: 0.5 },
  { id: 'DGS1', label: '1Y', tenor: 1 },
  { id: 'DGS2', label: '2Y', tenor: 2 },
  { id: 'DGS5', label: '5Y', tenor: 5 },
  { id: 'DGS10', label: '10Y', tenor: 10 },
  { id: 'DGS20', label: '20Y', tenor: 20 },
  { id: 'DGS30', label: '30Y', tenor: 30 },
];

interface YieldPoint {
  label: string;
  tenor: number;
  value: number | null;
}

interface YieldData {
  points: YieldPoint[];
  fetchedAt: string;
  spread2y10y: number | null;
  spread3m10y: number | null;
}

const economicClient = new EconomicServiceClient('', { fetch: (...args) => globalThis.fetch(...args) });

function latestObs(series: FredSeries | undefined): number | null {
  if (!series?.observations?.length) return null;
  const obs = [...series.observations].reverse().find(o => o.value !== null && o.value !== undefined && !isNaN(o.value));
  return obs ? obs.value : null;
}

function yieldCurveSvg(points: YieldPoint[], width = 340, height = 100): string {
  const valid = points.filter(p => p.value !== null) as Array<{ label: string; tenor: number; value: number }>;
  if (valid.length < 2) return '<div class="yc-no-data">Insufficient data</div>';

  const minY = Math.min(...valid.map(p => p.value));
  const maxY = Math.max(...valid.map(p => p.value));
  const rangeY = maxY - minY || 0.1;
  const pad = { top: 12, right: 18, bottom: 28, left: 34 };
  const w = width - pad.left - pad.right;
  const h = height - pad.top - pad.bottom;

  const xOf = (i: number) => pad.left + (i / (valid.length - 1)) * w;
  const yOf = (v: number) => pad.top + h - ((v - minY) / rangeY) * h;

  const pathD = valid.map((p, i) => `${i === 0 ? 'M' : 'L'}${xOf(i).toFixed(1)},${yOf(p.value).toFixed(1)}`).join(' ');
  const areaD = `${pathD} L${xOf(valid.length - 1).toFixed(1)},${(pad.top + h).toFixed(1)} L${xOf(0).toFixed(1)},${(pad.top + h).toFixed(1)} Z`;

  // Determine curve shape for color
  const isInverted = (valid.find(p => p.label === '2Y')?.value ?? 0) > (valid.find(p => p.label === '10Y')?.value ?? 0);
  const lineColor = isInverted ? '#f44336' : '#4caf50';

  // Y-axis ticks
  const ticks = 3;
  const yTicks = Array.from({ length: ticks }, (_, i) => {
    const v = minY + (rangeY / (ticks - 1)) * i;
    const y = yOf(v);
    return `<line x1="${pad.left}" x2="${pad.left + w}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>
            <text x="${(pad.left - 4).toFixed(1)}" y="${(y + 3).toFixed(1)}" font-size="9" fill="var(--text-dim)" text-anchor="end">${v.toFixed(1)}</text>`;
  }).join('');

  // X-axis labels
  const xLabels = valid.map((p, i) => {
    const x = xOf(i);
    return `<text x="${x.toFixed(1)}" y="${(pad.top + h + 14).toFixed(1)}" font-size="9" fill="var(--text-dim)" text-anchor="middle">${escapeHtml(p.label)}</text>`;
  }).join('');

  // Dot at each point
  const dots = valid.map((p, i) =>
    `<circle cx="${xOf(i).toFixed(1)}" cy="${yOf(p.value).toFixed(1)}" r="2.5" fill="${lineColor}"/>`,
  ).join('');

  return `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" class="yc-svg">
      <defs>
        <linearGradient id="ycGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${lineColor}" stop-opacity="0.25"/>
          <stop offset="100%" stop-color="${lineColor}" stop-opacity="0"/>
        </linearGradient>
      </defs>
      ${yTicks}
      <path d="${areaD}" fill="url(#ycGrad)" />
      <path d="${pathD}" fill="none" stroke="${lineColor}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
      ${dots}
      ${xLabels}
    </svg>`;
}

function spreadBadge(label: string, value: number | null): string {
  if (value === null) return '';
  const cls = value < 0 ? 'spread-inverted' : value < 0.5 ? 'spread-flat' : 'spread-normal';
  const sign = value >= 0 ? '+' : '';
  return `<div class="yc-spread-badge ${cls}">
    <span class="yc-spread-label">${escapeHtml(label)}</span>
    <span class="yc-spread-value">${sign}${value.toFixed(2)}%</span>
  </div>`;
}

export class YieldCurvePanel extends Panel {
  private data: YieldData | null = null;
  private loading = true;
  private error: string | null = null;

  constructor() {
    super({ id: 'yield-curve', title: t('panels.yieldCurve'), showCount: false });
    void this.fetchData();
  }

  public async fetchData(): Promise<void> {
    this.loading = true;
    this.error = null;
    this.renderPanel();

    try {
      const resp = await economicClient.getFredSeriesBatch({
        seriesIds: YIELD_SERIES.map(s => s.id),
        limit: 5,
      });

      const points: YieldPoint[] = YIELD_SERIES.map(s => ({
        label: s.label,
        tenor: s.tenor,
        value: latestObs(resp.results?.[s.id]),
      }));

      const y2 = points.find(p => p.label === '2Y')?.value ?? null;
      const y10 = points.find(p => p.label === '10Y')?.value ?? null;
      const y3m = points.find(p => p.label === '3M')?.value ?? null;

      this.data = {
        points,
        fetchedAt: new Date().toISOString(),
        spread2y10y: y2 !== null && y10 !== null ? y10 - y2 : null,
        spread3m10y: y3m !== null && y10 !== null ? y10 - y3m : null,
      };
      this.loading = false;
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to load yield data';
      this.loading = false;
    }

    if (!this.element?.isConnected) return;
    this.renderPanel();
    this.scheduleRefresh();
  }

  private scheduleRefresh(): void {
    setTimeout(() => {
      if (this.element?.isConnected) void this.fetchData();
    }, 15 * 60 * 1000); // refresh every 15 min
  }

  protected renderPanel(): void {
    if (this.loading) {
      this.showLoading();
      return;
    }
    if (this.error || !this.data) {
      this.showError(this.error ?? 'No data');
      return;
    }

    const { points, spread2y10y, spread3m10y } = this.data;
    const isInverted = spread2y10y !== null && spread2y10y < 0;

    const statusLabel = isInverted
      ? '<span class="yc-status inverted">⚠ Inverted curve</span>'
      : spread2y10y !== null && spread2y10y < 0.5
        ? '<span class="yc-status flat">Flat curve</span>'
        : '<span class="yc-status normal">Normal curve</span>';

    const rows = points
      .filter(p => p.value !== null)
      .map(p => {
        const v = p.value!;
        const barPct = Math.max(0, Math.min(100, (v / 8) * 100));
        const cls = v >= 5 ? 'yield-high' : v >= 3 ? 'yield-mid' : v >= 1 ? 'yield-low' : 'yield-near-zero';
        return `
          <div class="yc-row">
            <span class="yc-tenor">${escapeHtml(p.label)}</span>
            <div class="yc-bar-wrap">
              <div class="yc-bar ${cls}" style="width:${barPct.toFixed(1)}%"></div>
            </div>
            <span class="yc-rate ${cls}">${v.toFixed(2)}%</span>
          </div>`;
      }).join('');

    const content = `
      <div class="yc-container">
        <div class="yc-header-row">
          ${statusLabel}
          <div class="yc-spreads">
            ${spreadBadge('2s10s', spread2y10y)}
            ${spreadBadge('3m10y', spread3m10y)}
          </div>
        </div>
        <div class="yc-chart">
          ${yieldCurveSvg(points)}
        </div>
        <div class="yc-rates">
          ${rows}
        </div>
        <div class="yc-footer">US Treasury Yields · FRED · ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
      </div>`;

    this.setContent(content);
  }
}
