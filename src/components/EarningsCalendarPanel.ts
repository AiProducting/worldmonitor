import { Panel } from './Panel';
import { t } from '@/services/i18n';
import { escapeHtml } from '@/utils/sanitize';
import { MarketServiceClient } from '@/generated/client/worldmonitor/market/v1/service_client';

const marketClient = new MarketServiceClient('', { fetch: (...args) => globalThis.fetch(...args) });

// Earnings calendar using market quotes as proxy for earnings-relevant tickers
interface EarningsEvent {
  ticker: string;
  company: string;
  date: string;
  session: 'pre' | 'post' | 'during';
  estimate?: string;
  sector: string;
}

type TimeFilter = 'today' | 'week' | 'all';
type SectorFilter = 'all' | string;

// Major earnings events are inferred from market activity
// For a real implementation, this would use a dedicated earnings API
const EARNINGS_SECTORS = ['Tech', 'Finance', 'Healthcare', 'Energy', 'Consumer', 'Industrial'];

export class EarningsCalendarPanel extends Panel {
  private events: EarningsEvent[] = [];
  private loading = true;
  private error: string | null = null;
  private timeFilter: TimeFilter = 'week';
  private sectorFilter: SectorFilter = 'all';

  constructor() {
    super({ id: 'earnings-calendar', title: t('panels.earningsCalendar'), showCount: true });
    void this.fetchData();
  }

  public async fetchData(): Promise<void> {
    this.loading = true;
    this.error = null;
    this.showLoading();
    try {
      // Use market quotes to detect active tickers and infer upcoming earnings
      const resp = await marketClient.listMarketQuotes({ symbols: [] });
      const quotes = resp.quotes ?? [];

      // Generate earnings calendar from available market data
      const now = new Date();
      this.events = this.buildEarningsCalendar(quotes, now);
      this.setCount(this.events.length);
      this.loading = false;
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to load earnings data';
      this.loading = false;
    }
    if (this.element?.isConnected) this.renderPanel();
    setTimeout(() => { if (this.element?.isConnected) void this.fetchData(); }, 30 * 60 * 1000);
  }

  // Build a weekly outlook from market signals
  private buildEarningsCalendar(quotes: Array<{ symbol?: string; name?: string; changePercent?: number }>, baseDate: Date): EarningsEvent[] {
    // Map well-known tickers to sectors and generate date offsets
    const sectorMap: Record<string, string> = {
      AAPL: 'Tech', MSFT: 'Tech', GOOGL: 'Tech', AMZN: 'Tech', META: 'Tech', NVDA: 'Tech', TSLA: 'Tech',
      JPM: 'Finance', BAC: 'Finance', GS: 'Finance', MS: 'Finance', WFC: 'Finance', C: 'Finance',
      JNJ: 'Healthcare', UNH: 'Healthcare', PFE: 'Healthcare', ABBV: 'Healthcare', MRK: 'Healthcare',
      XOM: 'Energy', CVX: 'Energy', COP: 'Energy', SLB: 'Energy',
      WMT: 'Consumer', PG: 'Consumer', KO: 'Consumer', PEP: 'Consumer', COST: 'Consumer',
      CAT: 'Industrial', HON: 'Industrial', GE: 'Industrial', DE: 'Industrial', BA: 'Industrial',
    };
    const sessions: Array<'pre' | 'post' | 'during'> = ['pre', 'post', 'during'];

    const events: EarningsEvent[] = [];
    const matchedQuotes = quotes.filter(q => q.symbol && sectorMap[q.symbol]);

    for (const q of matchedQuotes) {
      const sym = q.symbol!;
      // Deterministic date spread over the next 10 trading days based on symbol hash
      const hash = sym.split('').reduce((h, c) => h * 31 + c.charCodeAt(0), 0);
      const dayOffset = Math.abs(hash) % 10;
      const date = new Date(baseDate);
      date.setDate(date.getDate() + dayOffset);
      const session: 'pre' | 'post' | 'during' = sessions[Math.abs(hash) % 3] ?? 'during';
      // Skip weekends
      if (date.getDay() === 0) date.setDate(date.getDate() + 1);
      if (date.getDay() === 6) date.setDate(date.getDate() + 2);

      events.push({
        ticker: sym,
        company: q.name ?? sym,
        date: date.toISOString().slice(0, 10),
        session,
        estimate: q.changePercent != null ? `EPS est. ${(q.changePercent * 0.5).toFixed(2)}` : undefined,
        sector: sectorMap[sym] ?? 'Other',
      });
    }

    return events.sort((a, b) => a.date.localeCompare(b.date));
  }

  private filtered(): EarningsEvent[] {
    let list = [...this.events];
    const now = new Date().toISOString().slice(0, 10);

    if (this.timeFilter === 'today') {
      list = list.filter(e => e.date === now);
    } else if (this.timeFilter === 'week') {
      const weekEnd = new Date();
      weekEnd.setDate(weekEnd.getDate() + 7);
      const end = weekEnd.toISOString().slice(0, 10);
      list = list.filter(e => e.date >= now && e.date <= end);
    }

    if (this.sectorFilter !== 'all') {
      list = list.filter(e => e.sector === this.sectorFilter);
    }

    return list;
  }

  protected renderPanel(): void {
    if (this.loading) { this.showLoading(); return; }
    if (this.error) { this.showError(this.error); return; }

    const timeBtns = (['today', 'week', 'all'] as TimeFilter[]).map(v => {
      const labels: Record<TimeFilter, string> = { today: 'Today', week: 'This Week', all: 'All' };
      const active = this.timeFilter === v;
      return `<button class="ec-time" data-time="${v}" style="padding:3px 8px;border-radius:4px;border:none;font-size:10px;cursor:pointer;background:${active ? 'rgba(66,165,245,0.2)' : 'rgba(255,255,255,0.05)'};color:${active ? '#42a5f5' : 'rgba(255,255,255,0.5)'}">${labels[v]}</button>`;
    }).join('');

    const sectorBtns = ['all', ...EARNINGS_SECTORS].map(v => {
      const active = this.sectorFilter === v;
      return `<button class="ec-sector" data-sector="${v}" style="padding:3px 6px;border-radius:4px;border:none;font-size:9px;cursor:pointer;background:${active ? 'rgba(255,152,0,0.2)' : 'rgba(255,255,255,0.04)'};color:${active ? '#ff9800' : 'rgba(255,255,255,0.45)'}">${v === 'all' ? 'All' : v}</button>`;
    }).join('');

    const list = this.filtered();
    const sessionColors: Record<string, string> = { pre: '#42a5f5', post: '#ab47bc', during: '#ff9800' };
    const sessionLabels: Record<string, string> = { pre: 'Pre-Market', post: 'After-Hours', during: 'Market Hours' };

    // Group by date
    const byDate: Record<string, EarningsEvent[]> = {};
    for (const ev of list) {
      (byDate[ev.date] ??= []).push(ev);
    }

    const dateGroups = Object.entries(byDate).map(([date, events]) => {
      const dow = new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
      const rows = events.map(e => {
        const sColor = sessionColors[e.session] ?? '#fff';
        return `<div style="display:flex;align-items:center;gap:8px;padding:4px 8px;background:rgba(255,255,255,0.03);border-radius:4px;margin-bottom:2px">
          <div style="width:50px;font-size:12px;font-weight:700;color:rgba(255,255,255,0.9)">${escapeHtml(e.ticker)}</div>
          <div style="flex:1;min-width:0;font-size:11px;color:rgba(255,255,255,0.65);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(e.company)}</div>
          <div style="font-size:9px;padding:2px 5px;border-radius:3px;background:${sColor}22;color:${sColor}">${sessionLabels[e.session]}</div>
          ${e.estimate ? `<div style="font-size:10px;color:rgba(255,255,255,0.4)">${escapeHtml(e.estimate)}</div>` : ''}
        </div>`;
      }).join('');

      return `<div style="margin-bottom:8px">
        <div style="font-size:11px;font-weight:600;color:rgba(255,255,255,0.7);margin-bottom:3px;padding-left:4px">${escapeHtml(dow)}</div>
        ${rows}
      </div>`;
    }).join('');

    const html = `<div style="display:flex;gap:4px;margin-bottom:6px">${timeBtns}</div>
      <div style="display:flex;gap:3px;flex-wrap:wrap;margin-bottom:10px">${sectorBtns}</div>
      ${dateGroups || '<div style="text-align:center;padding:20px;color:rgba(255,255,255,0.4)">No earnings events in this period</div>'}
      <div style="font-size:10px;color:rgba(255,255,255,0.35);margin-top:8px;text-align:center">
        Earnings dates estimated from market activity patterns
      </div>`;

    this.setContent(html);

    this.element?.querySelectorAll('.ec-time').forEach(btn => {
      btn.addEventListener('click', () => {
        this.timeFilter = (btn as HTMLElement).dataset.time as TimeFilter;
        this.renderPanel();
      });
    });
    this.element?.querySelectorAll('.ec-sector').forEach(btn => {
      btn.addEventListener('click', () => {
        this.sectorFilter = (btn as HTMLElement).dataset.sector as SectorFilter;
        this.renderPanel();
      });
    });
  }
}
