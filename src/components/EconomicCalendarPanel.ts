import { Panel } from './Panel';
import { t } from '@/services/i18n';
import { escapeHtml } from '@/utils/sanitize';
import { EconomicServiceClient } from '@/generated/client/worldmonitor/economic/v1/service_client';
import type { FredSeries } from '@/generated/client/worldmonitor/economic/v1/service_client';

const econClient = new EconomicServiceClient('', { fetch: (...args) => globalThis.fetch(...args) });

// Key economic indicators with their expected release cadence
interface EconEvent {
  id: string;
  name: string;
  frequency: 'monthly' | 'weekly' | 'quarterly';
  category: 'employment' | 'inflation' | 'growth' | 'housing' | 'manufacturing' | 'consumer';
  impact: 'high' | 'medium' | 'low';
  unit: string;
}

const EVENTS: EconEvent[] = [
  // Employment
  { id: 'UNRATE',       name: 'Unemployment Rate',     frequency: 'monthly', category: 'employment',    impact: 'high',   unit: '%' },
  { id: 'PAYEMS',       name: 'Nonfarm Payrolls',      frequency: 'monthly', category: 'employment',    impact: 'high',   unit: 'K' },
  { id: 'ICSA',         name: 'Initial Jobless Claims', frequency: 'weekly',  category: 'employment',    impact: 'high',   unit: 'K' },
  // Inflation
  { id: 'CPIAUCSL',     name: 'CPI (All Items)',        frequency: 'monthly', category: 'inflation',     impact: 'high',   unit: 'idx' },
  { id: 'PCEPI',        name: 'PCE Price Index',        frequency: 'monthly', category: 'inflation',     impact: 'high',   unit: 'idx' },
  { id: 'PPIFES',       name: 'PPI (Final Demand)',     frequency: 'monthly', category: 'inflation',     impact: 'medium', unit: 'idx' },
  // Growth
  { id: 'GDP',          name: 'Real GDP',               frequency: 'quarterly', category: 'growth',      impact: 'high',   unit: 'B$' },
  { id: 'INDPRO',       name: 'Industrial Production',  frequency: 'monthly', category: 'manufacturing', impact: 'medium', unit: 'idx' },
  // Consumer
  { id: 'RSAFS',        name: 'Retail Sales',           frequency: 'monthly', category: 'consumer',      impact: 'high',   unit: 'M$' },
  { id: 'UMCSENT',      name: 'Consumer Sentiment',     frequency: 'monthly', category: 'consumer',      impact: 'medium', unit: 'idx' },
  // Housing
  { id: 'HOUST',        name: 'Housing Starts',         frequency: 'monthly', category: 'housing',       impact: 'medium', unit: 'K' },
  { id: 'MORTGAGE30US', name: '30Y Mortgage Rate',      frequency: 'weekly',  category: 'housing',       impact: 'medium', unit: '%' },
  // Manufacturing
  { id: 'MANEMP',       name: 'Manufacturing Employment', frequency: 'monthly', category: 'manufacturing', impact: 'low', unit: 'K' },
];

const IMPACT_STYLE: Record<EconEvent['impact'], { color: string; bg: string }> = {
  high:   { color: '#f44336', bg: 'rgba(244,67,54,0.1)' },
  medium: { color: '#ffc107', bg: 'rgba(255,193,7,0.08)' },
  low:    { color: '#90a4ae', bg: 'rgba(144,164,174,0.06)' },
};

const CAT_ICON: Record<EconEvent['category'], string> = {
  employment: '👷',
  inflation: '📈',
  growth: '🏭',
  housing: '🏠',
  manufacturing: '⚙️',
  consumer: '🛒',
};

type CatFilter = 'all' | EconEvent['category'];

interface CalendarEntry {
  event: EconEvent;
  latestValue: number | null;
  previousValue: number | null;
  change: number | null;
  lastDate: string | null;
  nextEstDate: string | null;
}

function estimateNextRelease(lastDate: string | null, freq: EconEvent['frequency']): string | null {
  if (!lastDate) return null;
  const d = new Date(lastDate);
  if (isNaN(d.getTime())) return null;

  switch (freq) {
    case 'weekly': d.setDate(d.getDate() + 7); break;
    case 'monthly': d.setMonth(d.getMonth() + 1); break;
    case 'quarterly': d.setMonth(d.getMonth() + 3); break;
  }
  return d.toISOString().slice(0, 10);
}

function daysDiff(dateStr: string): number {
  const now = new Date();
  const d = new Date(dateStr);
  return Math.round((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

export class EconomicCalendarPanel extends Panel {
  private entries: CalendarEntry[] = [];
  private loading = true;
  private error: string | null = null;
  private catFilter: CatFilter = 'all';

  constructor() {
    super({ id: 'economic-calendar', title: t('panels.economicCalendar') });
    void this.fetchData();
  }

  public async fetchData(): Promise<void> {
    this.loading = true;
    this.error = null;
    this.showLoading();
    try {
      const ids = EVENTS.map(e => e.id);
      const res = await econClient.getFredSeriesBatch({ seriesIds: ids, limit: 10 });
      const results = res.results ?? {};

      this.entries = EVENTS.map(event => {
        const series: FredSeries | undefined = results[event.id];
        const obs = series?.observations ?? [];
        const sorted = [...obs].sort((a, b) => b.date.localeCompare(a.date));

        const latestValue = sorted[0]?.value ?? null;
        const previousValue = sorted[1]?.value ?? null;
        const lastDate = sorted[0]?.date ?? null;
        const change = latestValue != null && previousValue != null && previousValue !== 0
          ? ((latestValue - previousValue) / Math.abs(previousValue)) * 100
          : null;
        const nextEstDate = estimateNextRelease(lastDate, event.frequency);

        return { event, latestValue, previousValue, change, lastDate, nextEstDate };
      });

      // Sort by next estimated release date (soonest first)
      this.entries.sort((a, b) => {
        if (!a.nextEstDate) return 1;
        if (!b.nextEstDate) return -1;
        return a.nextEstDate.localeCompare(b.nextEstDate);
      });

      this.setCount(this.entries.filter(e => {
        if (!e.nextEstDate) return false;
        const days = daysDiff(e.nextEstDate);
        return days >= 0 && days <= 7;
      }).length);

      this.loading = false;
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to load economic calendar';
      this.loading = false;
    }
    if (this.element?.isConnected) this.renderPanel();
    setTimeout(() => { if (this.element?.isConnected) void this.fetchData(); }, 30 * 60 * 1000);
  }

  private filtered(): CalendarEntry[] {
    if (this.catFilter === 'all') return this.entries;
    return this.entries.filter(e => e.event.category === this.catFilter);
  }

  protected renderPanel(): void {
    if (this.loading) { this.showLoading(); return; }
    if (this.error) { this.showError(this.error); return; }

    const cats: CatFilter[] = ['all', 'employment', 'inflation', 'growth', 'consumer', 'housing', 'manufacturing'];
    const catBtns = cats.map(c => {
      const active = c === this.catFilter;
      const label = c === 'all' ? 'All' : c.charAt(0).toUpperCase() + c.slice(1);
      return `<button data-cat="${c}" style="background:${active ? 'rgba(66,165,245,0.2)' : 'transparent'};border:1px solid ${active ? '#42a5f5' : 'rgba(255,255,255,0.1)'};color:${active ? '#42a5f5' : 'rgba(255,255,255,0.5)'};border-radius:4px;padding:2px 6px;font-size:10px;cursor:pointer;white-space:nowrap">${label}</button>`;
    }).join('');

    const list = this.filtered();

    const rows = list.map(entry => {
      const ev = entry.event;
      const imp = IMPACT_STYLE[ev.impact];
      const icon = CAT_ICON[ev.category];
      const chColor = entry.change != null ? (entry.change > 0 ? '#66bb6a' : entry.change < 0 ? '#f44336' : '#90a4ae') : '#90a4ae';
      const chSign = entry.change != null && entry.change >= 0 ? '+' : '';

      let dateInfo = '';
      if (entry.nextEstDate) {
        const days = daysDiff(entry.nextEstDate);
        if (days < 0) {
          dateInfo = `<span style="color:rgba(255,255,255,0.4)">Released</span>`;
        } else if (days === 0) {
          dateInfo = `<span style="color:#f44336;font-weight:600">TODAY</span>`;
        } else if (days <= 3) {
          dateInfo = `<span style="color:#ffc107;font-weight:600">${days}d</span>`;
        } else {
          dateInfo = `<span style="color:rgba(255,255,255,0.5)">${days}d</span>`;
        }
      }

      const valueStr = entry.latestValue != null
        ? (ev.unit === '%' ? entry.latestValue.toFixed(1) + '%'
          : ev.unit === 'K' ? (entry.latestValue / 1000).toFixed(0) + 'K'
          : ev.unit === 'M$' ? '$' + (entry.latestValue / 1000).toFixed(0) + 'M'
          : ev.unit === 'B$' ? '$' + (entry.latestValue / 1000).toFixed(0) + 'B'
          : entry.latestValue.toFixed(1))
        : 'N/A';

      return `<div style="display:flex;align-items:center;gap:6px;padding:5px 8px;border-radius:4px;margin-bottom:2px;background:${imp.bg}">
        <div style="width:18px;text-align:center;font-size:12px">${icon}</div>
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:4px">
            <span style="font-size:12px;color:rgba(255,255,255,0.85)">${escapeHtml(ev.name)}</span>
            <span style="width:6px;height:6px;border-radius:50%;background:${imp.color};flex-shrink:0" title="${ev.impact} impact"></span>
          </div>
          <div style="font-size:10px;color:rgba(255,255,255,0.4)">${escapeHtml(ev.frequency)} • ${escapeHtml(entry.lastDate ?? 'N/A')}</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:12px;font-weight:600;color:rgba(255,255,255,0.9)">${valueStr}</div>
          <div style="font-size:10px;color:${chColor}">${entry.change != null ? `${chSign}${entry.change.toFixed(1)}%` : '—'}</div>
        </div>
        <div style="width:36px;text-align:right;font-size:10px">${dateInfo}</div>
      </div>`;
    }).join('');

    // Count upcoming high-impact events in next 7 days
    const upcoming7d = this.entries.filter(e => {
      if (!e.nextEstDate || e.event.impact !== 'high') return false;
      const d = daysDiff(e.nextEstDate);
      return d >= 0 && d <= 7;
    }).length;

    const html = `
      <div style="display:flex;gap:12px;justify-content:center;margin-bottom:8px;font-size:12px">
        <div><span style="color:#f44336;font-weight:600">${upcoming7d}</span> <span style="color:rgba(255,255,255,0.5)">High-impact next 7d</span></div>
        <div><span style="color:rgba(255,255,255,0.7);font-weight:600">${this.entries.length}</span> <span style="color:rgba(255,255,255,0.5)">Indicators tracked</span></div>
      </div>
      <div style="display:flex;gap:3px;flex-wrap:wrap;margin-bottom:8px" class="ec-cat-btns">${catBtns}</div>
      <div style="display:flex;gap:6px;padding:0 8px 4px;font-size:10px;color:rgba(255,255,255,0.35)">
        <div style="width:18px"></div>
        <div style="flex:1">Indicator</div>
        <div style="width:60px;text-align:right">Latest</div>
        <div style="width:36px;text-align:right">Next</div>
      </div>
      ${rows}
      <div style="font-size:10px;color:rgba(255,255,255,0.35);margin-top:8px;text-align:center">
        Impact: <span style="color:#f44336">●</span> High <span style="color:#ffc107">●</span> Medium <span style="color:#90a4ae">●</span> Low • Data via FRED
      </div>`;

    this.setContent(html);

    this.element?.querySelectorAll('[data-cat]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.catFilter = (btn as HTMLElement).dataset.cat as CatFilter;
        this.renderPanel();
      });
    });
  }
}
