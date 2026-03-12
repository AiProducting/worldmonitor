import { Panel } from './Panel';
import { t } from '@/services/i18n';
import { escapeHtml } from '@/utils/sanitize';
import { MarketServiceClient } from '@/generated/client/worldmonitor/market/v1/service_client';
import type { SectorPerformance } from '@/generated/client/worldmonitor/market/v1/service_client';

const marketClient = new MarketServiceClient('', { fetch: (...args) => globalThis.fetch(...args) });

interface BreadthData {
  sectors: SectorPerformance[];
  advancing: number;
  declining: number;
  unchanged: number;
  ratio: number; // advance/decline
  breadthThrust: number; // % advancing
}

function breadthLabel(thrust: number): { text: string; color: string } {
  if (thrust >= 80) return { text: 'Strong Rally', color: '#2e7d32' };
  if (thrust >= 60) return { text: 'Broad Advance', color: '#66bb6a' };
  if (thrust >= 40) return { text: 'Mixed', color: '#ffc107' };
  if (thrust >= 20) return { text: 'Broad Decline', color: '#f44336' };
  return { text: 'Washout', color: '#d32f2f' };
}

function breadthGauge(thrust: number, size = 160): string {
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 10;
  const startAngle = -135;
  const endAngle = startAngle + (thrust / 100) * 270;
  const startRad = (startAngle * Math.PI) / 180;
  const endRad = (endAngle * Math.PI) / 180;
  const x1 = cx + r * Math.cos(startRad);
  const y1 = cy + r * Math.sin(startRad);
  const x2 = cx + r * Math.cos(endRad);
  const y2 = cy + r * Math.sin(endRad);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  const { color, text } = breadthLabel(thrust);

  const bgEndRad = ((startAngle + 270) * Math.PI) / 180;
  const bx2 = cx + r * Math.cos(bgEndRad);
  const by2 = cy + r * Math.sin(bgEndRad);

  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
    <path d="M ${x1},${y1} A ${r},${r} 0 1 1 ${bx2},${by2}" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="8" stroke-linecap="round"/>
    <path d="M ${x1},${y1} A ${r},${r} 0 ${largeArc} 1 ${x2},${y2}" fill="none" stroke="${color}" stroke-width="8" stroke-linecap="round"/>
    <text x="${cx}" y="${cx - 6}" text-anchor="middle" fill="${color}" font-size="26" font-weight="bold">${Math.round(thrust)}%</text>
    <text x="${cx}" y="${cx + 14}" text-anchor="middle" fill="rgba(255,255,255,0.7)" font-size="11">${escapeHtml(text)}</text>
  </svg>`;
}

export class MarketBreadthPanel extends Panel {
  private data: BreadthData | null = null;
  private loading = true;
  private error: string | null = null;

  constructor() {
    super({ id: 'market-breadth', title: t('panels.marketBreadth') });
    void this.fetchData();
  }

  public async fetchData(): Promise<void> {
    this.loading = true;
    this.error = null;
    this.showLoading();
    try {
      const resp = await marketClient.getSectorSummary({ period: '1d' });
      const sectors = resp.sectors ?? [];

      let advancing = 0;
      let declining = 0;
      let unchanged = 0;
      for (const s of sectors) {
        if (s.change > 0.05) advancing++;
        else if (s.change < -0.05) declining++;
        else unchanged++;
      }

      const total = sectors.length || 1;
      const ratio = declining > 0 ? advancing / declining : advancing > 0 ? Infinity : 1;
      const breadthThrust = (advancing / total) * 100;

      this.data = { sectors, advancing, declining, unchanged, ratio, breadthThrust };
      this.setCount(advancing);
      this.loading = false;
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to load breadth data';
      this.loading = false;
    }
    if (this.element?.isConnected) this.renderPanel();
    setTimeout(() => { if (this.element?.isConnected) void this.fetchData(); }, 10 * 60 * 1000);
  }

  protected renderPanel(): void {
    if (this.loading) { this.showLoading(); return; }
    if (this.error) { this.showError(this.error); return; }
    if (!this.data) return;

    const d = this.data;
    const { color } = breadthLabel(d.breadthThrust);

    const sectorRows = [...d.sectors]
      .sort((a, b) => b.change - a.change)
      .map(s => {
        const pct = s.change.toFixed(2);
        const barColor = s.change > 0 ? '#66bb6a' : s.change < 0 ? '#f44336' : '#90a4ae';
        const barW = Math.min(80, Math.abs(s.change) * 20);
        const sign = s.change >= 0 ? '+' : '';
        return `<div style="display:flex;align-items:center;gap:8px;padding:4px 8px;border-radius:4px;margin-bottom:2px;background:${s.change > 0 ? 'rgba(102,187,106,0.08)' : s.change < 0 ? 'rgba(244,67,54,0.08)' : 'transparent'}">
          <div style="flex:1;font-size:12px;color:rgba(255,255,255,0.85)">${escapeHtml(s.name)}</div>
          <div style="width:80px;height:4px;background:rgba(255,255,255,0.05);border-radius:2px;overflow:hidden;direction:${s.change >= 0 ? 'ltr' : 'rtl'}">
            <div style="width:${barW}%;height:100%;background:${barColor};border-radius:2px"></div>
          </div>
          <div style="width:50px;text-align:right;font-size:12px;font-weight:600;color:${barColor}">${sign}${pct}%</div>
        </div>`;
      }).join('');

    const ratioStr = d.ratio === Infinity ? '∞' : d.ratio.toFixed(2);

    const html = `
      <div style="text-align:center">${breadthGauge(d.breadthThrust)}</div>
      <div style="display:flex;justify-content:center;gap:16px;margin:8px 0;font-size:12px">
        <div><span style="color:#66bb6a;font-weight:600">${d.advancing}</span> <span style="color:rgba(255,255,255,0.5)">Advancing</span></div>
        <div><span style="color:#f44336;font-weight:600">${d.declining}</span> <span style="color:rgba(255,255,255,0.5)">Declining</span></div>
        <div><span style="color:${color};font-weight:600">${ratioStr}</span> <span style="color:rgba(255,255,255,0.5)">A/D Ratio</span></div>
      </div>
      <div style="margin-top:10px">
        <div style="font-size:11px;color:rgba(255,255,255,0.5);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.5px">Sector Performance</div>
        ${sectorRows}
      </div>
      <div style="font-size:10px;color:rgba(255,255,255,0.35);margin-top:8px;text-align:center">
        Sector breadth via 11 SPDR ETFs • Updated every 10 min
      </div>`;

    this.setContent(html);
  }
}
