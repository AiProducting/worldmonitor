import { Panel } from './Panel';
import { t } from '@/services/i18n';
import { TradeServiceClient } from '@/generated/client/worldmonitor/trade/v1/service_client';
import type { TradeFlowRecord } from '@/generated/client/worldmonitor/trade/v1/service_client';

const tradeClient = new TradeServiceClient('', { fetch: (...args) => globalThis.fetch(...args) });

// Major bilateral pairs to track
interface Pair { reporter: string; partner: string; label: string; region: string; }

const PAIRS: Pair[] = [
  { reporter: 'US', partner: 'CN', label: 'US → China',     region: 'US' },
  { reporter: 'US', partner: 'EU', label: 'US → EU',        region: 'US' },
  { reporter: 'US', partner: 'JP', label: 'US → Japan',     region: 'US' },
  { reporter: 'US', partner: 'MX', label: 'US → Mexico',    region: 'US' },
  { reporter: 'US', partner: 'CA', label: 'US → Canada',    region: 'US' },
  { reporter: 'US', partner: 'KR', label: 'US → S.Korea',   region: 'US' },
  { reporter: 'CN', partner: 'US', label: 'China → US',     region: 'CN' },
  { reporter: 'CN', partner: 'EU', label: 'China → EU',     region: 'CN' },
  { reporter: 'CN', partner: 'JP', label: 'China → Japan',  region: 'CN' },
  { reporter: 'DE', partner: 'CN', label: 'Germany → China',region: 'EU' },
  { reporter: 'DE', partner: 'US', label: 'Germany → US',   region: 'EU' },
  { reporter: 'JP', partner: 'US', label: 'Japan → US',     region: 'AP' },
  { reporter: 'JP', partner: 'CN', label: 'Japan → China',  region: 'AP' },
];

type RegionFilter = 'all' | 'US' | 'CN' | 'EU' | 'AP';
type SortMode = 'balance' | 'exports' | 'imports' | 'name';

function fmtUsd(v: number): string {
  if (!Number.isFinite(v)) return 'N/A';
  const abs = Math.abs(v);
  if (abs >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
  if (abs >= 1e9)  return `$${(v / 1e9).toFixed(1)}B`;
  if (abs >= 1e6)  return `$${(v / 1e6).toFixed(1)}M`;
  return `$${v.toFixed(0)}`;
}

function fmtChg(v: number): string {
  if (!Number.isFinite(v)) return '';
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
}

interface PairResult {
  pair: Pair;
  flow: TradeFlowRecord | null;
  error: boolean;
}

export class TradeFlowsPanel extends Panel {
  private results: PairResult[] = PAIRS.map(p => ({ pair: p, flow: null, error: false }));
  private loading = true;
  private regionFilter: RegionFilter = 'all';
  private sortMode: SortMode = 'balance';
  private fetched = false;

  constructor() {
    super({ id: 'trade-flows', title: t('panels.tradeFlows'), showCount: true });
    void this.fetchData();
  }

  public async fetchData(): Promise<void> {
    if (this.fetched) return;
    this.fetched = true;
    this.loading = true;
    this.showLoading();

    // Fetch all pairs in parallel, years=5
    const settled = await Promise.allSettled(
      PAIRS.map(p =>
        tradeClient.getTradeFlows({ reportingCountry: p.reporter, partnerCountry: p.partner, years: 5 }),
      ),
    );

    this.results = PAIRS.map((p, i) => {
      const res = settled[i]!;
      if (res.status === 'rejected') return { pair: p, flow: null, error: true };
      // Use the most recent year's record
      const flows = res.value.flows ?? [];
      const sorted = [...flows].sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
      return { pair: p, flow: sorted[0] ?? null, error: false };
    });

    this.loading = false;
    if (this.element?.isConnected) this.renderPanel();

    // Refresh every 2 hours
    setTimeout(() => {
      this.fetched = false;
      if (this.element?.isConnected) void this.fetchData();
    }, 2 * 60 * 60 * 1000);
  }

  private visible(): PairResult[] {
    let list = this.regionFilter === 'all'
      ? [...this.results]
      : this.results.filter(r => r.pair.region === this.regionFilter);

    list.sort((a, b) => {
      if (this.sortMode === 'name') return a.pair.label.localeCompare(b.pair.label);
      if (this.sortMode === 'exports') return (b.flow?.exportValueUsd ?? 0) - (a.flow?.exportValueUsd ?? 0);
      if (this.sortMode === 'imports') return (b.flow?.importValueUsd ?? 0) - (a.flow?.importValueUsd ?? 0);
      // balance = exports - imports (most negative first = biggest deficit)
      const balA = (a.flow?.exportValueUsd ?? 0) - (a.flow?.importValueUsd ?? 0);
      const balB = (b.flow?.exportValueUsd ?? 0) - (b.flow?.importValueUsd ?? 0);
      return balA - balB; // ascending: biggest deficits first
    });

    return list;
  }

  protected renderPanel(): void {
    if (this.loading) { this.showLoading(); return; }

    const visible = this.visible();
    const allFlows = this.results.filter(r => r.flow);

    // Total deficit (exports - imports across all pairs with data)
    const totalExp = allFlows.reduce((s, r) => s + (r.flow?.exportValueUsd ?? 0), 0);
    const totalImp = allFlows.reduce((s, r) => s + (r.flow?.importValueUsd ?? 0), 0);
    const totalBal = totalExp - totalImp;

    const regionBtns: RegionFilter[] = ['all', 'US', 'CN', 'EU', 'AP'];
    const sortBtns: { key: SortMode; label: string }[] = [
      { key: 'balance', label: 'Balance' },
      { key: 'exports', label: 'Exports' },
      { key: 'imports', label: 'Imports' },
      { key: 'name',    label: 'Name' },
    ];

    const rBar = regionBtns.map(r =>
      `<button class="tfl-region-btn${this.regionFilter === r ? ' active' : ''}" data-region="${r}">${r === 'all' ? 'All' : r === 'AP' ? 'Asia' : r}</button>`,
    ).join('');

    const sBar = sortBtns.map(s =>
      `<button class="tfl-sort-btn${this.sortMode === s.key ? ' active' : ''}" data-sort="${s.key}">${s.label}</button>`,
    ).join('');

    // Compute max abs value for bar scaling
    const maxBal = Math.max(...visible.map(r => {
      const f = r.flow;
      if (!f) return 0;
      return Math.max(Math.abs(f.exportValueUsd), Math.abs(f.importValueUsd));
    }), 1);

    const rows = visible.map(r => {
      if (!r.flow) {
        return `<div class="tfl-row tfl-row-na"><span class="tfl-label">${r.pair.label}</span><span class="tfl-na">No data</span></div>`;
      }
      const f = r.flow;
      const balance = f.exportValueUsd - f.importValueUsd;
      const isDeficit = balance < 0;
      const expPct = (f.exportValueUsd / maxBal) * 100;
      const impPct = (f.importValueUsd / maxBal) * 100;
      const expChg = fmtChg(f.yoyExportChange);
      const impChg = fmtChg(f.yoyImportChange);

      return `
        <div class="tfl-row">
          <div class="tfl-row-head">
            <span class="tfl-label">${r.pair.label}</span>
            <span class="tfl-balance ${isDeficit ? 'deficit' : 'surplus'}">${isDeficit ? '▼' : '▲'} ${fmtUsd(Math.abs(balance))}</span>
            <span class="tfl-year">${f.year}</span>
          </div>
          <div class="tfl-bars">
            <div class="tfl-bar-row">
              <span class="tfl-bar-label">EXP</span>
              <div class="tfl-bar-track">
                <div class="tfl-bar-fill exp" style="width:${expPct.toFixed(1)}%"></div>
              </div>
              <span class="tfl-bar-val">${fmtUsd(f.exportValueUsd)} ${expChg ? `<span class="tfl-chg ${f.yoyExportChange >= 0 ? 'pos' : 'neg'}">${expChg}</span>` : ''}</span>
            </div>
            <div class="tfl-bar-row">
              <span class="tfl-bar-label">IMP</span>
              <div class="tfl-bar-track">
                <div class="tfl-bar-fill imp" style="width:${impPct.toFixed(1)}%"></div>
              </div>
              <span class="tfl-bar-val">${fmtUsd(f.importValueUsd)} ${impChg ? `<span class="tfl-chg ${f.yoyImportChange >= 0 ? 'pos' : 'neg'}">${impChg}</span>` : ''}</span>
            </div>
          </div>
        </div>`;
    }).join('');

    const content = `
      <div class="tfl-container">
        <div class="tfl-toolbar">
          <div class="tfl-region-bar">${rBar}</div>
          <div class="tfl-sort-bar">${sBar}</div>
        </div>
        <div class="tfl-summary">
          <span class="tfl-sum-exp">Exports: <strong>${fmtUsd(totalExp)}</strong></span>
          <span class="tfl-sum-imp">Imports: <strong>${fmtUsd(totalImp)}</strong></span>
          <span class="tfl-sum-bal ${totalBal >= 0 ? 'surplus' : 'deficit'}">Balance: <strong>${fmtUsd(totalBal)}</strong></span>
        </div>
        <div class="tfl-list">${rows}</div>
        <div class="yc-footer">UN Comtrade · WTO bilateral trade flows</div>
      </div>`;

    this.setContent(content);

    this.element?.querySelectorAll('.tfl-region-btn').forEach(btn =>
      btn.addEventListener('click', e => {
        const r = (e.currentTarget as HTMLElement).dataset['region'] as RegionFilter;
        if (r) { this.regionFilter = r; this.renderPanel(); }
      }),
    );
    this.element?.querySelectorAll('.tfl-sort-btn').forEach(btn =>
      btn.addEventListener('click', e => {
        const s = (e.currentTarget as HTMLElement).dataset['sort'] as SortMode;
        if (s) { this.sortMode = s; this.renderPanel(); }
      }),
    );
  }
}
