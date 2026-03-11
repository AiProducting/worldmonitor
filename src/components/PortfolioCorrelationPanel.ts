import { Panel } from './Panel';
import { t } from '@/services/i18n';
import { escapeHtml } from '@/utils/sanitize';
import { EconomicServiceClient } from '@/generated/client/worldmonitor/economic/v1/service_client';
import type { FredSeries } from '@/generated/client/worldmonitor/economic/v1/service_client';

const econClient = new EconomicServiceClient('', { fetch: (...args) => globalThis.fetch(...args) });

// Cross-asset pairs to track correlations
interface AssetDef {
  id: string;
  label: string;
  shortLabel: string;
  category: string;
}

const ASSETS: AssetDef[] = [
  { id: 'SP500',         label: 'S&P 500',          shortLabel: 'SPX',   category: 'Equity' },
  { id: 'NASDAQCOM',     label: 'NASDAQ',           shortLabel: 'NDX',   category: 'Equity' },
  { id: 'DTWEXBGS',      label: 'USD Index (Broad)', shortLabel: 'DXY',   category: 'FX' },
  { id: 'DCOILWTICO',    label: 'WTI Crude Oil',    shortLabel: 'WTI',   category: 'Commodity' },
  { id: 'GOLDAMGBD228NLBM', label: 'Gold',          shortLabel: 'Gold',  category: 'Commodity' },
  { id: 'DGS10',         label: '10Y Treasury',     shortLabel: '10Y',   category: 'Bond' },
  { id: 'DGS2',          label: '2Y Treasury',      shortLabel: '2Y',    category: 'Bond' },
  { id: 'VIXCLS',        label: 'VIX',              shortLabel: 'VIX',   category: 'Vol' },
];

type ViewMode = 'matrix' | 'leaders';

function pearsonCorrelation(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 5) return 0;
  const ax = a.slice(0, n);
  const bx = b.slice(0, n);
  const meanA = ax.reduce((s, v) => s + v, 0) / n;
  const meanB = bx.reduce((s, v) => s + v, 0) / n;
  let num = 0, denA = 0, denB = 0;
  for (let i = 0; i < n; i++) {
    const da = ax[i] - meanA;
    const db = bx[i] - meanB;
    num += da * db;
    denA += da * da;
    denB += db * db;
  }
  const den = Math.sqrt(denA * denB);
  return den === 0 ? 0 : num / den;
}

function correlationColor(r: number): string {
  const abs = Math.abs(r);
  if (r > 0) {
    // Positive: green shades
    const a = Math.round(abs * 0.6 * 255).toString(16).padStart(2, '0');
    return `#4caf50${a}`;
  }
  // Negative: red shades
  const a = Math.round(abs * 0.6 * 255).toString(16).padStart(2, '0');
  return `#f44336${a}`;
}

export class PortfolioCorrelationPanel extends Panel {
  private data: Map<string, FredSeries> = new Map();
  private loading = true;
  private error: string | null = null;
  private view: ViewMode = 'matrix';
  private correlations: Map<string, number> = new Map();

  constructor() {
    super({ id: 'portfolio-correlation', title: t('panels.portfolioCorrelation') });
    void this.fetchData();
  }

  public async fetchData(): Promise<void> {
    this.loading = true;
    this.error = null;
    this.showLoading();
    try {
      // Fetch in 2 batches (API limit ≈ 10)
      const batch1 = ASSETS.slice(0, 5).map(a => a.id);
      const batch2 = ASSETS.slice(5).map(a => a.id);
      const [res1, res2] = await Promise.all([
        econClient.getFredSeriesBatch({ seriesIds: batch1, limit: 60 }),
        econClient.getFredSeriesBatch({ seriesIds: batch2, limit: 60 }),
      ]);
      for (const res of [res1, res2]) {
        for (const [id, series] of Object.entries(res.results ?? {})) {
          this.data.set(id, series);
        }
      }
      this.computeCorrelations();
      this.loading = false;
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to load correlation data';
      this.loading = false;
    }
    if (this.element?.isConnected) this.renderPanel();
    setTimeout(() => { if (this.element?.isConnected) void this.fetchData(); }, 20 * 60 * 1000);
  }

  private getReturns(id: string): number[] {
    const series = this.data.get(id);
    if (!series?.observations?.length) return [];
    const sorted = [...series.observations].sort((a, b) => a.date.localeCompare(b.date));
    const vals = sorted.map(o => o.value).filter(v => Number.isFinite(v));
    const returns: number[] = [];
    for (let i = 1; i < vals.length; i++) {
      if (vals[i - 1] !== 0) returns.push((vals[i] - vals[i - 1]) / Math.abs(vals[i - 1]));
    }
    return returns;
  }

  private computeCorrelations(): void {
    this.correlations.clear();
    for (let i = 0; i < ASSETS.length; i++) {
      const ri = this.getReturns(ASSETS[i].id);
      for (let j = i; j < ASSETS.length; j++) {
        const rj = this.getReturns(ASSETS[j].id);
        const r = i === j ? 1 : pearsonCorrelation(ri, rj);
        const key = `${ASSETS[i].id}:${ASSETS[j].id}`;
        this.correlations.set(key, r);
      }
    }
  }

  private getCorr(a: string, b: string): number {
    return this.correlations.get(`${a}:${b}`) ?? this.correlations.get(`${b}:${a}`) ?? 0;
  }

  protected renderPanel(): void {
    if (this.loading) { this.showLoading(); return; }
    if (this.error) { this.showError(this.error); return; }

    const tabs = `<div class="pc-tabs" style="display:flex;gap:4px;margin-bottom:10px">
      ${(['matrix', 'leaders'] as ViewMode[]).map(v =>
        `<button class="pc-tab" data-view="${v}" style="padding:4px 10px;border-radius:4px;border:none;font-size:11px;cursor:pointer;background:${this.view === v ? 'rgba(66,165,245,0.3)' : 'rgba(255,255,255,0.06)'};color:${this.view === v ? '#42a5f5' : 'rgba(255,255,255,0.6)'}">${v === 'matrix' ? 'Correlation Matrix' : 'Top Movers'}</button>`
      ).join('')}
    </div>`;

    const content = this.view === 'matrix' ? this.renderMatrix() : this.renderLeaders();

    const html = `${tabs}${content}
      <div style="font-size:10px;color:rgba(255,255,255,0.35);margin-top:8px;text-align:center">
        Pearson correlation on daily returns (60-day window) via FRED
      </div>`;

    this.setContent(html);

    this.element?.querySelectorAll('.pc-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        this.view = (btn as HTMLElement).dataset.view as ViewMode;
        this.renderPanel();
      });
    });
  }

  private renderMatrix(): string {
    const sz = ASSETS.length;
    const cellSize = 36;
    const headerH = 50;
    const labelW = 44;

    const headers = ASSETS.map((a, i) =>
      `<text x="${labelW + i * cellSize + cellSize / 2}" y="${headerH - 4}" text-anchor="middle" fill="rgba(255,255,255,0.6)" font-size="9" transform="rotate(-35, ${labelW + i * cellSize + cellSize / 2}, ${headerH - 4})">${escapeHtml(a.shortLabel)}</text>`
    ).join('');

    const rowLabels = ASSETS.map((a, i) =>
      `<text x="${labelW - 4}" y="${headerH + i * cellSize + cellSize / 2 + 3}" text-anchor="end" fill="rgba(255,255,255,0.6)" font-size="9">${escapeHtml(a.shortLabel)}</text>`
    ).join('');

    const cells: string[] = [];
    for (let i = 0; i < sz; i++) {
      for (let j = 0; j < sz; j++) {
        const r = this.getCorr(ASSETS[i].id, ASSETS[j].id);
        const x = labelW + j * cellSize;
        const y = headerH + i * cellSize;
        const bg = correlationColor(r);
        cells.push(`<rect x="${x}" y="${y}" width="${cellSize - 1}" height="${cellSize - 1}" rx="3" fill="${bg}"/>`);
        cells.push(`<text x="${x + cellSize / 2}" y="${y + cellSize / 2 + 3}" text-anchor="middle" fill="rgba(255,255,255,0.8)" font-size="8" font-weight="600">${r.toFixed(2)}</text>`);
      }
    }

    const w = labelW + sz * cellSize;
    const h = headerH + sz * cellSize;
    return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" style="max-width:100%">${headers}${rowLabels}${cells.join('')}</svg>`;
  }

  private renderLeaders(): string {
    const pairs: Array<{ a: AssetDef; b: AssetDef; r: number }> = [];
    for (let i = 0; i < ASSETS.length; i++) {
      for (let j = i + 1; j < ASSETS.length; j++) {
        pairs.push({ a: ASSETS[i], b: ASSETS[j], r: this.getCorr(ASSETS[i].id, ASSETS[j].id) });
      }
    }

    const strongest = [...pairs].sort((a, b) => Math.abs(b.r) - Math.abs(a.r)).slice(0, 6);
    const mostNeg = [...pairs].sort((a, b) => a.r - b.r).slice(0, 4);

    const row = (p: typeof pairs[0]) => {
      const color = p.r > 0 ? '#4caf50' : '#f44336';
      const w = Math.abs(p.r) * 100;
      return `<div style="display:flex;align-items:center;gap:8px;padding:5px 8px;background:rgba(255,255,255,0.03);border-radius:4px;margin-bottom:3px">
        <div style="flex:1;font-size:12px;color:rgba(255,255,255,0.8)">${escapeHtml(p.a.shortLabel)} ↔ ${escapeHtml(p.b.shortLabel)}</div>
        <div style="width:50px;height:5px;background:rgba(255,255,255,0.06);border-radius:3px;overflow:hidden"><div style="width:${w}%;height:100%;background:${color};border-radius:3px"></div></div>
        <div style="width:40px;text-align:right;font-size:11px;font-weight:600;color:${color}">${p.r >= 0 ? '+' : ''}${p.r.toFixed(2)}</div>
      </div>`;
    };

    return `<div>
      <div style="font-size:11px;color:rgba(255,255,255,0.5);margin-bottom:4px">Strongest Correlations</div>
      ${strongest.map(row).join('')}
      <div style="font-size:11px;color:rgba(255,255,255,0.5);margin:10px 0 4px">Most Negative</div>
      ${mostNeg.map(row).join('')}
    </div>`;
  }
}
