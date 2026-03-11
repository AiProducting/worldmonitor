import { Panel } from './Panel';
import { t } from '@/services/i18n';
import { EconomicServiceClient } from '@/generated/client/worldmonitor/economic/v1/service_client';
import type { FredSeries } from '@/generated/client/worldmonitor/economic/v1/service_client';

const econClient = new EconomicServiceClient('', { fetch: (...args) => globalThis.fetch(...args) });

interface InflationComponent {
  id: string;
  label: string;
  category: 'headline' | 'core' | 'components';
  weight?: number; // approximate CPI weight %
}

type CatFilter = 'all' | 'headline' | 'core' | 'components';

const COMPONENTS: InflationComponent[] = [
  // Headline measures
  { id: 'CPIAUCSL',      label: 'CPI All Items',           category: 'headline', weight: 100 },
  { id: 'PCEPI',         label: 'PCE Deflator',            category: 'headline' },
  { id: 'PPIFES',        label: 'PPI Core (Finished)',     category: 'headline' },
  // Core measures
  { id: 'CPILFESL',      label: 'Core CPI (ex Food/Energy)', category: 'core' },
  { id: 'PCEPILFE',      label: 'Core PCE',                category: 'core' },
  // CPI components
  { id: 'CUSR0000SAH1',  label: 'Shelter',                 category: 'components', weight: 34 },
  { id: 'CUSR0000SAF',   label: 'Food',                    category: 'components', weight: 14 },
  { id: 'CUSR0000SA0E',  label: 'Energy',                  category: 'components', weight: 7 },
  { id: 'CPIMEDSL',      label: 'Medical Care',            category: 'components', weight: 9 },
  { id: 'CPITRNSL',      label: 'Transportation',          category: 'components', weight: 6 },
  { id: 'CUSR0000SAA',   label: 'Apparel',                 category: 'components', weight: 3 },
  { id: 'CUSR0000SETB01', label: 'Gasoline',               category: 'components', weight: 4 },
  { id: 'CUSR0000SAS4',  label: 'Education & Comms',       category: 'components', weight: 7 },
];

const CAT_COLORS: Record<InflationComponent['category'], string> = {
  headline:   '#ff9800',
  core:       '#42a5f5',
  components: '#ab47bc',
};

function yoyRate(obs: FredSeries['observations'] | undefined): number | null {
  if (!obs || obs.length < 13) return null;
  const sorted = [...obs].sort((a, b) => b.date.localeCompare(a.date));
  const curr = sorted[0]?.value;
  const prev = sorted[12]?.value;
  if (curr == null || prev == null || prev === 0) return null;
  return ((curr - prev) / Math.abs(prev)) * 100;
}

function momRate(obs: FredSeries['observations'] | undefined): number | null {
  if (!obs || obs.length < 2) return null;
  const sorted = [...obs].sort((a, b) => b.date.localeCompare(a.date));
  const curr = sorted[0]?.value;
  const prev = sorted[1]?.value;
  if (curr == null || prev == null || prev === 0) return null;
  return ((curr - prev) / Math.abs(prev)) * 100;
}

function rateColor(rate: number | null): string {
  if (rate == null) return '#90a4ae';
  if (rate >= 5) return '#ef5350';
  if (rate >= 3) return '#ff9800';
  if (rate >= 2) return '#ffca28';
  if (rate >= 0) return '#66bb6a';
  return '#42a5f5'; // deflation = blue
}

function sparkBars(obs: FredSeries['observations'] | undefined, _color: string): string {
  // Show 12 monthly YoY rates as tiny bar chart
  if (!obs || obs.length < 14) return '';
  const sorted = [...obs].sort((a, b) => b.date.localeCompare(a.date));
  const rates: number[] = [];
  for (let i = 0; i < 12 && i + 12 < sorted.length; i++) {
    const curr = sorted[i]?.value;
    const prev = sorted[i + 12]?.value;
    if (curr != null && prev != null && prev !== 0) {
      rates.unshift(((curr - prev) / Math.abs(prev)) * 100);
    }
  }
  if (!rates.length) return '';
  const maxR = Math.max(...rates.map(Math.abs), 0.01);
  const W = 60; const H = 18;
  const barW = W / rates.length - 1;
  const bars = rates.map((r, i) => {
    const h = Math.max((Math.abs(r) / maxR) * (H - 2), 1);
    const y = H - h; // top of bar
    const x = i * (barW + 1);
    const c = rateColor(r);
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" fill="${c}"/>`;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" class="inf-spark">${bars}</svg>`;
}

export class InflationBreakdownPanel extends Panel {
  private data = new Map<string, FredSeries>();
  private loading = true;
  private error: string | null = null;
  private catFilter: CatFilter = 'all';

  constructor() {
    super({ id: 'inflation-breakdown', title: t('panels.inflationBreakdown') });
    void this.fetchData();
  }

  public async fetchData(): Promise<void> {
    this.loading = true;
    this.error = null;
    this.showLoading();
    try {
      const res = await econClient.getFredSeriesBatch({ seriesIds: COMPONENTS.map(c => c.id), limit: 26 });
      for (const [id, series] of Object.entries(res.results ?? {})) {
        this.data.set(id, series);
      }
      this.loading = false;
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to load inflation data';
      this.loading = false;
    }
    if (this.element?.isConnected) this.renderPanel();
    setTimeout(() => { if (this.element?.isConnected) void this.fetchData(); }, 60 * 60 * 1000);
  }

  protected renderPanel(): void {
    if (this.loading) { this.showLoading(); return; }
    if (this.error) { this.showError(this.error); return; }

    const cats: CatFilter[] = ['all', 'headline', 'core', 'components'];
    const catBtns = cats.map(c => {
      const cc = c !== 'all' ? CAT_COLORS[c as InflationComponent['category']] : '';
      return `<button class="inf-cat-btn${this.catFilter === c ? ' active' : ''}" data-cat="${c}" style="${cc ? `--cc:${cc}` : ''}">${c === 'all' ? 'All' : c.charAt(0).toUpperCase() + c.slice(1)}</button>`;
    }).join('');

    // Headline summary
    const cpiSeries = this.data.get('CPIAUCSL');
    const cpiYoy    = yoyRate(cpiSeries?.observations);
    const pceSeries = this.data.get('PCEPI');
    const pceYoy    = yoyRate(pceSeries?.observations);
    const cpiMom    = momRate(cpiSeries?.observations);

    const summaryHtml = `
      <div class="inf-summary">
        ${cpiYoy != null ? `<div class="inf-sum-item"><span class="inf-sum-label">CPI YoY</span><span class="inf-sum-val" style="color:${rateColor(cpiYoy)}">${cpiYoy.toFixed(1)}%</span></div>` : ''}
        ${pceYoy != null ? `<div class="inf-sum-item"><span class="inf-sum-label">PCE YoY</span><span class="inf-sum-val" style="color:${rateColor(pceYoy)}">${pceYoy.toFixed(1)}%</span></div>` : ''}
        ${cpiMom != null ? `<div class="inf-sum-item"><span class="inf-sum-label">CPI MoM</span><span class="inf-sum-val" style="color:${rateColor(cpiMom * 12)}">${(cpiMom * 12).toFixed(1)}% ann.</span></div>` : ''}
      </div>`;

    const visible = this.catFilter === 'all'
      ? COMPONENTS
      : COMPONENTS.filter(c => c.category === this.catFilter);

    const rows = visible.map(comp => {
      const series = this.data.get(comp.id);
      const yoy    = yoyRate(series?.observations);
      const mom    = momRate(series?.observations);
      const cc     = CAT_COLORS[comp.category];

      if (yoy == null && mom == null) {
        return `<div class="inf-row inf-na"><span class="inf-label">${comp.label}</span><span class="inf-na-text">N/A</span></div>`;
      }

      const spark = sparkBars(series?.observations, rateColor(yoy));
      const yoyColor = rateColor(yoy);

      return `
        <div class="inf-row">
          <span class="inf-cat-dot" style="background:${cc}"></span>
          <div class="inf-label-col">
            <span class="inf-label">${comp.label}</span>
            ${comp.weight ? `<span class="inf-weight">~${comp.weight}% wt.</span>` : ''}
          </div>
          <div class="inf-row-right">
            ${spark}
            ${yoy != null ? `<span class="inf-yoy" style="color:${yoyColor}">${yoy.toFixed(1)}%</span>` : ''}
            ${mom != null ? `<span class="inf-mom">${mom >= 0 ? '+' : ''}${(mom * 12).toFixed(1)}% ann.</span>` : ''}
          </div>
        </div>`;
    }).join('');

    const content = `
      <div class="inf-container">
        <div class="inf-toolbar"><div class="inf-cat-bar">${catBtns}</div></div>
        ${summaryHtml}
        <div class="inf-legend"><span class="inf-legend-item" style="color:#66bb6a">≤2% target</span><span class="inf-legend-item" style="color:#ff9800">2-5% elevated</span><span class="inf-legend-item" style="color:#ef5350">≥5% high</span></div>
        <div class="inf-list">${rows}</div>
        <div class="yc-footer">US Bureau of Labor Statistics · BLS CPI components · PCE</div>
      </div>`;

    this.setContent(content);

    this.element?.querySelectorAll('.inf-cat-btn').forEach(btn =>
      btn.addEventListener('click', e => {
        const c = (e.currentTarget as HTMLElement).dataset['cat'] as CatFilter;
        if (c) { this.catFilter = c; this.renderPanel(); }
      }),
    );
  }
}
