import { Panel } from './Panel';
import { t } from '@/services/i18n';
import { EconomicServiceClient } from '@/generated/client/worldmonitor/economic/v1/service_client';
import type { FredSeries } from '@/generated/client/worldmonitor/economic/v1/service_client';

const econClient = new EconomicServiceClient('', { fetch: (...args) => globalThis.fetch(...args) });

// G10 + EM sovereign 10Y yield series from FRED (OECD long-term rates)
interface BondMeta { id: string; country: string; countryCode: string; region: string; }
type RegionFilter = 'all' | 'Americas' | 'Europe' | 'Asia' | 'EM';

const BONDS: BondMeta[] = [
  // Americas
  { id: 'DGS10',              country: 'United States',  countryCode: 'US', region: 'Americas' },
  { id: 'IRLTLT01CAM156N',    country: 'Canada',         countryCode: 'CA', region: 'Americas' },
  { id: 'IRLTLT01MXM156N',    country: 'Mexico',         countryCode: 'MX', region: 'EM' },
  { id: 'IRLTLT01BRM156N',    country: 'Brazil',         countryCode: 'BR', region: 'EM' },
  // Europe
  { id: 'IRLTLT01DEM156N',    country: 'Germany',        countryCode: 'DE', region: 'Europe' },
  { id: 'IRLTLT01GBM156N',    country: 'UK',             countryCode: 'GB', region: 'Europe' },
  { id: 'IRLTLT01FRM156N',    country: 'France',         countryCode: 'FR', region: 'Europe' },
  { id: 'IRLTLT01ITM156N',    country: 'Italy',          countryCode: 'IT', region: 'Europe' },
  { id: 'IRLTLT01ESM156N',    country: 'Spain',          countryCode: 'ES', region: 'Europe' },
  { id: 'IRLTLT01NLM156N',    country: 'Netherlands',    countryCode: 'NL', region: 'Europe' },
  { id: 'IRLTLT01CHM156N',    country: 'Switzerland',    countryCode: 'CH', region: 'Europe' },
  // Asia-Pacific
  { id: 'IRLTLT01JPM156N',    country: 'Japan',          countryCode: 'JP', region: 'Asia' },
  { id: 'IRLTLT01AUM156N',    country: 'Australia',      countryCode: 'AU', region: 'Asia' },
  { id: 'IRLTLT01KRM156N',    country: 'South Korea',    countryCode: 'KR', region: 'Asia' },
  { id: 'IRLTLT01INM156N',    country: 'India',          countryCode: 'IN', region: 'EM' },
  { id: 'IRLTLT01CNM156N',    country: 'China',          countryCode: 'CN', region: 'EM' },
];

// US yield curve extras for curve section
const US_CURVE_IDS = ['DGS3MO', 'DGS2', 'DGS5', 'DGS10', 'DGS30'];
const US_CURVE_LABELS: Record<string, string> = {
  DGS3MO: '3M', DGS2: '2Y', DGS5: '5Y', DGS10: '10Y', DGS30: '30Y',
};

type SortMode = 'yield-desc' | 'yield-asc' | 'spread' | 'name';

export class BondYieldsGlobalPanel extends Panel {
  private bondData: Map<string, FredSeries> = new Map();
  private loading = true;
  private error: string | null = null;
  private region: RegionFilter = 'all';
  private sortBy: SortMode = 'yield-desc';

  constructor() {
    super({ id: 'bond-yields-global', title: t('panels.bondYieldsGlobal') });
    void this.fetchData();
  }

  public async fetchData(): Promise<void> {
    this.loading = true;
    this.error = null;
    this.showLoading();
    const allIds = [...BONDS.map(b => b.id), ...US_CURVE_IDS];
    const uniqueIds = [...new Set(allIds)];
    try {
      const res = await econClient.getFredSeriesBatch({ seriesIds: uniqueIds, limit: 3 });
      for (const [id, series] of Object.entries(res.results ?? {})) {
        this.bondData.set(id, series);
      }
      this.loading = false;
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to load bond yields';
      this.loading = false;
    }
    if (this.element?.isConnected) this.renderPanel();
    setTimeout(() => { if (this.element?.isConnected) void this.fetchData(); }, 30 * 60 * 1000);
  }

  private latest(seriesId: string): number | null {
    const s = this.bondData.get(seriesId);
    if (!s?.observations?.length) return null;
    const obs = [...s.observations].sort((a, b) => b.date.localeCompare(a.date));
    return obs[0]?.value ?? null;
  }

  private prev(seriesId: string): number | null {
    const s = this.bondData.get(seriesId);
    if (!s?.observations || s.observations.length < 2) return null;
    const obs = [...s.observations].sort((a, b) => b.date.localeCompare(a.date));
    return obs[1]?.value ?? null;
  }

  private visibleBonds(): BondMeta[] {
    const list = this.region === 'all' ? [...BONDS] : BONDS.filter(b => b.region === this.region);
    const usYield = this.latest('DGS10') ?? 0;
    list.sort((a, b) => {
      const yA = this.latest(a.id) ?? -99;
      const yB = this.latest(b.id) ?? -99;
      if (this.sortBy === 'yield-desc') return yB - yA;
      if (this.sortBy === 'yield-asc')  return yA - yB;
      if (this.sortBy === 'spread') return (yB - usYield) - (yA - usYield);
      return a.country.localeCompare(b.country);
    });
    return list;
  }

  protected renderPanel(): void {
    if (this.loading) { this.showLoading(); return; }
    if (this.error) { this.showError(this.error); return; }

    const visible = this.visibleBonds();
    const usYield = this.latest('DGS10') ?? 0;

    // Max yield for bar scaling
    const maxYield = Math.max(...visible.map(b => this.latest(b.id) ?? 0), 0.01);

    const regionBtns: RegionFilter[] = ['all', 'Americas', 'Europe', 'Asia', 'EM'];
    const sortBtns: { key: SortMode; label: string }[] = [
      { key: 'yield-desc', label: 'High→Low' },
      { key: 'yield-asc',  label: 'Low→High' },
      { key: 'spread',     label: '±US' },
      { key: 'name',       label: 'Name' },
    ];

    const rBar = regionBtns.map(r =>
      `<button class="bgy-region-btn${this.region === r ? ' active' : ''}" data-region="${r}">${r === 'all' ? 'All' : r}</button>`,
    ).join('');
    const sBar = sortBtns.map(s =>
      `<button class="bgy-sort-btn${this.sortBy === s.key ? ' active' : ''}" data-sort="${s.key}">${s.label}</button>`,
    ).join('');

    const rows = visible.map(b => {
      const y = this.latest(b.id);
      const p = this.prev(b.id);
      if (y == null) return `<div class="bgy-row bgy-na"><span class="bgy-country">${b.country}</span><span class="bgy-na-text">N/A</span></div>`;

      const spread = y - usYield;
      const chg = p != null ? y - p : null;
      const barPct = (y / maxYield) * 100;
      const yieldColor = y > 6 ? '#ef5350' : y > 4 ? '#ff9800' : y > 2 ? '#42a5f5' : '#66bb6a';

      return `
        <div class="bgy-row">
          <span class="bgy-flag">${b.countryCode}</span>
          <span class="bgy-country">${b.country}</span>
          <div class="bgy-bar-track">
            <div class="bgy-bar-fill" style="width:${barPct.toFixed(1)}%;background:${yieldColor}"></div>
          </div>
          <span class="bgy-yield" style="color:${yieldColor}">${y.toFixed(2)}%</span>
          <span class="bgy-spread ${spread >= 0 ? 'pos' : 'neg'}">
            ${b.id !== 'DGS10' ? `${spread >= 0 ? '+' : ''}${spread.toFixed(0)}bp` : 'base'}
          </span>
          ${chg != null ? `<span class="bgy-chg ${chg >= 0 ? 'pos' : 'neg'}">${chg >= 0 ? '▲' : '▼'}${Math.abs(chg).toFixed(2)}</span>` : ''}
        </div>`;
    }).join('');

    // US Yield Curve mini section
    const curveData = US_CURVE_IDS.map(id => ({ label: US_CURVE_LABELS[id]!, yield: this.latest(id) }));
    const maxCurveY = Math.max(...curveData.map(c => c.yield ?? 0), 0.01);
    const curveSection = `
      <div class="bgy-curve">
        <div class="bgy-curve-title">US Yield Curve</div>
        <div class="bgy-curve-bars">
          ${curveData.map(c => {
            const y = c.yield;
            const h = y != null ? Math.max((y / maxCurveY) * 50, 2) : 2;
            return `<div class="bgy-curve-col">
              <span class="bgy-curve-val">${y != null ? y.toFixed(2) : 'N/A'}</span>
              <div class="bgy-curve-bar" style="height:${h.toFixed(0)}px"></div>
              <span class="bgy-curve-label">${c.label}</span>
            </div>`;
          }).join('')}
        </div>
      </div>`;

    const content = `
      <div class="bgy-container">
        <div class="bgy-toolbar">
          <div class="bgy-region-bar">${rBar}</div>
          <div class="bgy-sort-bar">${sBar}</div>
        </div>
        <div class="bgy-list">${rows}</div>
        ${curveSection}
        <div class="yc-footer">Federal Reserve FRED · OECD long-term govt bond yields</div>
      </div>`;

    this.setContent(content);

    this.element?.querySelectorAll('.bgy-region-btn').forEach(btn =>
      btn.addEventListener('click', e => {
        const r = (e.currentTarget as HTMLElement).dataset['region'] as RegionFilter;
        if (r) { this.region = r; this.renderPanel(); }
      }),
    );
    this.element?.querySelectorAll('.bgy-sort-btn').forEach(btn =>
      btn.addEventListener('click', e => {
        const s = (e.currentTarget as HTMLElement).dataset['sort'] as SortMode;
        if (s) { this.sortBy = s; this.renderPanel(); }
      }),
    );
  }
}
