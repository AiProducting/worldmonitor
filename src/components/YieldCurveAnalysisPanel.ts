import { Panel } from './Panel';
import { t } from '@/services/i18n';
import { escapeHtml } from '@/utils/sanitize';
import { EconomicServiceClient } from '@/generated/client/worldmonitor/economic/v1/service_client';
import type { FredSeries } from '@/generated/client/worldmonitor/economic/v1/service_client';

const econClient = new EconomicServiceClient('', { fetch: (...args) => globalThis.fetch(...args) });

// Treasury yield maturity series from FRED
interface YieldPoint {
  id: string;
  label: string;
  months: number; // for x-axis positioning
}

const YIELDS: YieldPoint[] = [
  { id: 'DGS1MO',  label: '1M',   months: 1 },
  { id: 'DGS3MO',  label: '3M',   months: 3 },
  { id: 'DGS6MO',  label: '6M',   months: 6 },
  { id: 'DGS1',    label: '1Y',   months: 12 },
  { id: 'DGS2',    label: '2Y',   months: 24 },
  { id: 'DGS3',    label: '3Y',   months: 36 },
  { id: 'DGS5',    label: '5Y',   months: 60 },
  { id: 'DGS7',    label: '7Y',   months: 84 },
  { id: 'DGS10',   label: '10Y',  months: 120 },
  { id: 'DGS20',   label: '20Y',  months: 240 },
  { id: 'DGS30',   label: '30Y',  months: 360 },
];

// Spreads to monitor
interface SpreadDef {
  longId: string;
  shortId: string;
  label: string;
  warnBelow: number;
  dangerBelow: number;
}

const SPREADS: SpreadDef[] = [
  { longId: 'DGS10', shortId: 'DGS2',   label: '10Y-2Y',  warnBelow: 0.5,  dangerBelow: 0 },
  { longId: 'DGS10', shortId: 'DGS3MO', label: '10Y-3M',  warnBelow: 0.5,  dangerBelow: 0 },
  { longId: 'DGS30', shortId: 'DGS5',   label: '30Y-5Y',  warnBelow: 0.3,  dangerBelow: 0 },
  { longId: 'DGS5',  shortId: 'DGS2',   label: '5Y-2Y',   warnBelow: 0.25, dangerBelow: 0 },
];

type ViewMode = 'curve' | 'spreads' | 'history';

function spreadColor(val: number, sp: SpreadDef): string {
  if (val <= sp.dangerBelow) return '#f44336';
  if (val <= sp.warnBelow) return '#ff9800';
  return '#4caf50';
}

export class YieldCurveAnalysisPanel extends Panel {
  private data: Map<string, FredSeries> = new Map();
  private loading = true;
  private error: string | null = null;
  private view: ViewMode = 'curve';

  constructor() {
    super({ id: 'yield-curve-analysis', title: t('panels.yieldCurveAnalysis') });
    void this.fetchData();
  }

  public async fetchData(): Promise<void> {
    this.loading = true;
    this.error = null;
    this.showLoading();
    try {
      const ids = YIELDS.map(y => y.id);
      const res = await econClient.getFredSeriesBatch({ seriesIds: ids, limit: 30 });
      for (const [id, series] of Object.entries(res.results ?? {})) {
        this.data.set(id, series);
      }
      this.loading = false;
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to load yield data';
      this.loading = false;
    }
    if (this.element?.isConnected) this.renderPanel();
    setTimeout(() => { if (this.element?.isConnected) void this.fetchData(); }, 10 * 60 * 1000);
  }

  private latest(id: string): number | null {
    const s = this.data.get(id);
    if (!s?.observations?.length) return null;
    const sorted = [...s.observations].sort((a, b) => b.date.localeCompare(a.date));
    return sorted[0]?.value ?? null;
  }

  private historical(id: string, daysAgo: number): number | null {
    const s = this.data.get(id);
    if (!s?.observations?.length) return null;
    const sorted = [...s.observations].sort((a, b) => b.date.localeCompare(a.date));
    return sorted[Math.min(daysAgo, sorted.length - 1)]?.value ?? null;
  }

  protected renderPanel(): void {
    if (this.loading) { this.showLoading(); return; }
    if (this.error) { this.showError(this.error); return; }

    const tabs = `<div style="display:flex;gap:4px;margin-bottom:10px">
      ${(['curve', 'spreads', 'history'] as ViewMode[]).map(v => {
        const labels: Record<ViewMode, string> = { curve: 'Yield Curve', spreads: 'Key Spreads', history: 'Change' };
        const active = this.view === v;
        return `<button class="yca-tab" data-view="${v}" style="padding:4px 10px;border-radius:4px;border:none;font-size:11px;cursor:pointer;background:${active ? 'rgba(66,165,245,0.3)' : 'rgba(255,255,255,0.06)'};color:${active ? '#42a5f5' : 'rgba(255,255,255,0.6)'}">${labels[v]}</button>`;
      }).join('')}
    </div>`;

    let content = '';
    switch (this.view) {
      case 'curve': content = this.renderCurve(); break;
      case 'spreads': content = this.renderSpreads(); break;
      case 'history': content = this.renderHistory(); break;
    }

    // Inversion alert
    const spread10y2y = (this.latest('DGS10') ?? 0) - (this.latest('DGS2') ?? 0);
    const inversionAlert = spread10y2y < 0
      ? `<div style="background:rgba(244,67,54,0.15);border:1px solid rgba(244,67,54,0.3);border-radius:6px;padding:8px 12px;margin-bottom:10px;font-size:12px;color:#f44336">
          ⚠ Yield Curve Inverted — 10Y-2Y spread at ${spread10y2y.toFixed(2)}%. Historically signals recession risk.
        </div>`
      : '';

    this.setContent(inversionAlert + tabs + content + `
      <div style="font-size:10px;color:rgba(255,255,255,0.35);margin-top:8px;text-align:center">
        U.S. Treasury yields via FRED • Updated every 10 min
      </div>`);

    this.element?.querySelectorAll('.yca-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        this.view = (btn as HTMLElement).dataset.view as ViewMode;
        this.renderPanel();
      });
    });
  }

  private renderCurve(): string {
    const points: Array<{ label: string; months: number; value: number }> = [];
    for (const y of YIELDS) {
      const v = this.latest(y.id);
      if (v != null) points.push({ label: y.label, months: y.months, value: v });
    }
    if (!points.length) return '<div style="text-align:center;color:rgba(255,255,255,0.4)">No yield data</div>';

    const W = 320;
    const H = 160;
    const PAD = { top: 15, right: 20, bottom: 30, left: 35 };
    const plotW = W - PAD.left - PAD.right;
    const plotH = H - PAD.top - PAD.bottom;

    const maxM = Math.max(...points.map(p => p.months));
    const vals = points.map(p => p.value);
    const minV = Math.min(...vals) - 0.2;
    const maxV = Math.max(...vals) + 0.2;
    const rangeV = maxV - minV || 1;

    const toX = (m: number) => PAD.left + (m / maxM) * plotW;
    const toY = (v: number) => PAD.top + (1 - (v - minV) / rangeV) * plotH;

    const linePts = points.map(p => `${toX(p.months).toFixed(1)},${toY(p.value).toFixed(1)}`).join(' ');

    // Gradient fill area
    const areaPath = `M ${toX(points[0].months).toFixed(1)},${toY(points[0].value).toFixed(1)} ` +
      points.slice(1).map(p => `L ${toX(p.months).toFixed(1)},${toY(p.value).toFixed(1)}`).join(' ') +
      ` L ${toX(points[points.length - 1].months).toFixed(1)},${(PAD.top + plotH).toFixed(1)} L ${toX(points[0].months).toFixed(1)},${(PAD.top + plotH).toFixed(1)} Z`;

    const dots = points.map(p =>
      `<circle cx="${toX(p.months).toFixed(1)}" cy="${toY(p.value).toFixed(1)}" r="3" fill="#42a5f5"/>
       <text x="${toX(p.months).toFixed(1)}" y="${(PAD.top + plotH + 15).toFixed(1)}" text-anchor="middle" fill="rgba(255,255,255,0.5)" font-size="8">${escapeHtml(p.label)}</text>`
    ).join('');

    // Y-axis labels
    const ySteps = 5;
    const yLabels = Array.from({ length: ySteps + 1 }, (_, i) => {
      const v = minV + (rangeV / ySteps) * i;
      return `<text x="${PAD.left - 4}" y="${toY(v).toFixed(1)}" text-anchor="end" fill="rgba(255,255,255,0.4)" font-size="8" dominant-baseline="middle">${v.toFixed(1)}%</text>
        <line x1="${PAD.left}" y1="${toY(v).toFixed(1)}" x2="${W - PAD.right}" y2="${toY(v).toFixed(1)}" stroke="rgba(255,255,255,0.05)" stroke-width="0.5"/>`;
    }).join('');

    return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" style="max-width:100%">
      <defs><linearGradient id="yca-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="rgba(66,165,245,0.3)"/><stop offset="100%" stop-color="rgba(66,165,245,0.02)"/></linearGradient></defs>
      ${yLabels}
      <path d="${areaPath}" fill="url(#yca-fill)"/>
      <polyline points="${linePts}" fill="none" stroke="#42a5f5" stroke-width="2"/>
      ${dots}
    </svg>`;
  }

  private renderSpreads(): string {
    return SPREADS.map(sp => {
      const longV = this.latest(sp.longId);
      const shortV = this.latest(sp.shortId);
      if (longV == null || shortV == null) return '';
      const spread = longV - shortV;
      const color = spreadColor(spread, sp);
      const status = spread <= sp.dangerBelow ? 'INVERTED' : spread <= sp.warnBelow ? 'Flat' : 'Normal';
      return `<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:rgba(255,255,255,0.03);border-radius:6px;margin-bottom:4px;border-left:3px solid ${color}">
        <div style="flex:1">
          <div style="font-size:13px;color:rgba(255,255,255,0.85);font-weight:600">${escapeHtml(sp.label)}</div>
          <div style="font-size:11px;color:rgba(255,255,255,0.45)">${longV.toFixed(2)}% − ${shortV.toFixed(2)}%</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:16px;font-weight:700;color:${color}">${spread >= 0 ? '+' : ''}${spread.toFixed(2)}%</div>
          <div style="font-size:10px;color:${color}">${status}</div>
        </div>
      </div>`;
    }).join('');
  }

  private renderHistory(): string {
    const periods = [
      { label: '1 Day', days: 1 },
      { label: '1 Week', days: 5 },
      { label: '1 Month', days: 22 },
    ];

    const rows = YIELDS.filter(y => this.latest(y.id) != null).map(y => {
      const current = this.latest(y.id)!;
      const changes = periods.map(p => {
        const prev = this.historical(y.id, p.days);
        if (prev == null) return { label: p.label, change: null };
        return { label: p.label, change: current - prev };
      });

      return `<div style="display:flex;align-items:center;gap:4px;padding:4px 8px;background:rgba(255,255,255,0.02);border-radius:4px;margin-bottom:2px">
        <div style="width:36px;font-size:12px;font-weight:600;color:rgba(255,255,255,0.8)">${escapeHtml(y.label)}</div>
        <div style="width:48px;font-size:12px;color:rgba(255,255,255,0.7)">${current.toFixed(2)}%</div>
        ${changes.map(c => {
          if (c.change == null) return '<div style="width:52px;text-align:center;font-size:10px;color:rgba(255,255,255,0.3)">—</div>';
          const col = c.change > 0.02 ? '#f44336' : c.change < -0.02 ? '#4caf50' : 'rgba(255,255,255,0.5)';
          return `<div style="width:52px;text-align:center;font-size:10px;color:${col}">${c.change >= 0 ? '+' : ''}${(c.change * 100).toFixed(0)} bps</div>`;
        }).join('')}
      </div>`;
    }).join('');

    const header = `<div style="display:flex;align-items:center;gap:4px;padding:2px 8px;margin-bottom:4px">
      <div style="width:36px;font-size:9px;color:rgba(255,255,255,0.4)">Mat.</div>
      <div style="width:48px;font-size:9px;color:rgba(255,255,255,0.4)">Yield</div>
      ${periods.map(p => `<div style="width:52px;text-align:center;font-size:9px;color:rgba(255,255,255,0.4)">Δ ${p.label}</div>`).join('')}
    </div>`;

    return header + rows;
  }
}
