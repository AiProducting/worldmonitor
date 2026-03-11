import { Panel } from './Panel';
import { t } from '@/services/i18n';
import { escapeHtml } from '@/utils/sanitize';
import { EconomicServiceClient } from '@/generated/client/worldmonitor/economic/v1/service_client';
import type { WorldBankCountryData } from '@/generated/client/worldmonitor/economic/v1/service_client';

// World Bank indicators with metadata
const INDICATORS: Array<{
  code: string;
  label: string;
  unit: string;
  desc: string;
  higherIsBetter: boolean;
}> = [
  { code: 'NY.GDP.PCAP.CD',     label: 'GDP per Capita',       unit: 'USD',  desc: 'GDP per person (current USD)', higherIsBetter: true },
  { code: 'NY.GDP.MKTP.KD.ZG',  label: 'GDP Growth',           unit: '%',    desc: 'Annual GDP growth rate', higherIsBetter: true },
  { code: 'FP.CPI.TOTL.ZG',     label: 'Inflation (CPI)',      unit: '%',    desc: 'Consumer price index inflation', higherIsBetter: false },
  { code: 'SL.UEM.TOTL.ZS',     label: 'Unemployment',         unit: '%',    desc: 'Unemployment rate', higherIsBetter: false },
  { code: 'NE.TRD.GNFS.ZS',     label: 'Trade / GDP',          unit: '%',    desc: 'Trade openness (exports+imports/GDP)', higherIsBetter: true },
  { code: 'GC.DOD.TOTL.GD.ZS',  label: 'Gov. Debt / GDP',      unit: '%',    desc: 'Central government debt as % of GDP', higherIsBetter: false },
];

// G20 + important countries
const G20_COUNTRIES = [
  'US', 'CN', 'JP', 'DE', 'IN', 'GB', 'FR', 'BR', 'IT', 'CA',
  'KR', 'RU', 'AU', 'MX', 'ID', 'TR', 'SA', 'AR', 'ZA', 'EU',
  'NG', 'EG', 'SG', 'CH', 'PL', 'TH', 'SE', 'NO',
];

const FLAG_MAP: Record<string, string> = {
  US: '🇺🇸', CN: '🇨🇳', JP: '🇯🇵', DE: '🇩🇪', IN: '🇮🇳', GB: '🇬🇧', FR: '🇫🇷', BR: '🇧🇷', IT: '🇮🇹', CA: '🇨🇦',
  KR: '🇰🇷', RU: '🇷🇺', AU: '🇦🇺', MX: '🇲🇽', ID: '🇮🇩', TR: '🇹🇷', SA: '🇸🇦', AR: '🇦🇷', ZA: '🇿🇦', EU: '🇪🇺',
  NG: '🇳🇬', EG: '🇪🇬', SG: '🇸🇬', CH: '🇨🇭', PL: '🇵🇱', TH: '🇹🇭', SE: '🇸🇪', NO: '🇳🇴',
};

type IndicatorKey = typeof INDICATORS[number]['code'];

const economicClient = new EconomicServiceClient('', { fetch: (...args) => globalThis.fetch(...args) });

function fmtValue(value: number, unit: string, code: string): string {
  if (code === 'NY.GDP.PCAP.CD') {
    return `$${value >= 1000 ? value.toLocaleString(undefined, { maximumFractionDigits: 0 }) : value.toFixed(0)}`;
  }
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)}${unit === '%' ? '%' : ''}`;
}

export class WorldBankGdpPanel extends Panel {
  private data: WorldBankCountryData[] = [];
  private loading = true;
  private error: string | null = null;
  private activeIndicator: IndicatorKey = 'NY.GDP.PCAP.CD';

  constructor() {
    super({ id: 'world-bank-gdp', title: t('panels.worldBankGdp'), showCount: false });
    void this.fetchData();
  }

  public async fetchData(): Promise<void> {
    this.loading = true;
    this.error = null;
    this.renderPanel();
    try {
      // Fetch all indicators in parallel; limit to 50 results per indicator
      const requests = INDICATORS.map(ind =>
        economicClient.listWorldBankIndicators({
          indicatorCode: ind.code,
          countryCode: '',   // empty = all countries
          year: 0,           // 0 = most recent
          pageSize: 50,
          cursor: '',
        }).catch(() => ({ data: [] as WorldBankCountryData[], pagination: undefined })),
      );
      const results = await Promise.all(requests);
      this.data = results.flatMap(r => r.data ?? []);
      this.loading = false;
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to load World Bank data';
      this.loading = false;
    }
    if (!this.element?.isConnected) return;
    this.renderPanel();
    setTimeout(() => { if (this.element?.isConnected) void this.fetchData(); }, 60 * 60 * 1000);
  }

  private getIndicatorData(code: IndicatorKey): WorldBankCountryData[] {
    return this.data
      .filter(d => d.indicatorCode === code && G20_COUNTRIES.includes(d.countryCode))
      .sort((a, b) => b.value - a.value)
      .slice(0, 20);
  }

  protected renderPanel(): void {
    if (this.loading) { this.showLoading(); return; }
    if (this.error || !this.data.length) { this.showError(this.error ?? 'No World Bank data'); return; }

    const ind = INDICATORS.find(i => i.code === this.activeIndicator) ?? INDICATORS[0]!;
    const rows = this.getIndicatorData(this.activeIndicator);
    if (!rows.length) { this.showError('No data for selected indicator'); return; }

    const maxVal = Math.max(...rows.map(r => r.value));

    const indBtns = INDICATORS.map(i =>
      `<button class="wb-ind-btn${this.activeIndicator === i.code ? ' active' : ''}" data-ind="${i.code}" title="${escapeHtml(i.desc)}">${escapeHtml(i.label)}</button>`,
    ).join('');

    const tableRows = rows.map((row, idx) => {
      const flag = FLAG_MAP[row.countryCode] ?? '🌐';
      const barPct = maxVal > 0 ? (row.value / maxVal) * 100 : 0;
      const goodVal = ind.higherIsBetter ? (row.value >= rows[Math.floor(rows.length * 0.6)]!.value) : (row.value <= rows[Math.floor(rows.length * 0.4)]!.value);
      const barColor = goodVal ? '#4caf50' : '#ef5350';
      return `
        <div class="wb-row">
          <span class="wb-rank">${idx + 1}</span>
          <span class="wb-flag">${flag}</span>
          <span class="wb-country">${escapeHtml(row.countryName)}</span>
          <div class="wb-bar-col">
            <div class="wb-bar-track"><div class="wb-bar-fill" style="width:${barPct.toFixed(1)}%;background:${barColor}"></div></div>
          </div>
          <span class="wb-value">${fmtValue(row.value, ind.unit, ind.code)}</span>
        </div>`;
    }).join('');

    const latestYear = rows[0]?.year ?? '?';

    const content = `
      <div class="wb-container">
        <div class="wb-ind-bar">${indBtns}</div>
        <div class="wb-desc">${escapeHtml(ind.desc)} · ${latestYear}</div>
        <div class="wb-list">${tableRows}</div>
        <div class="yc-footer">World Bank Open Data · G20+ Countries</div>
      </div>`;

    this.setContent(content);
    this.element?.querySelectorAll('.wb-ind-btn').forEach(btn =>
      btn.addEventListener('click', e => {
        const code = (e.currentTarget as HTMLElement).dataset['ind'] as IndicatorKey;
        if (code) { this.activeIndicator = code; this.renderPanel(); }
      }),
    );
  }
}
