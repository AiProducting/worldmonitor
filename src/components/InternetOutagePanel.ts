import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import type { InternetOutage } from '@/types';

const SEV_COLORS: Record<string, string> = {
  total: '#ef4444',
  major: '#f97316',
  partial: '#eab308',
};

const SEV_LABELS: Record<string, string> = {
  total: 'Total',
  major: 'Major',
  partial: 'Partial',
};

function timeAgo(d: Date): string {
  const diffMs = Date.now() - d.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export class InternetOutagePanel extends Panel {
  private outages: InternetOutage[] = [];
  private onOutageClick?: (lat: number, lon: number) => void;

  constructor() {
    super({
      id: 'internet-outages',
      title: 'Internet Outages',
      showCount: true,
      trackActivity: true,
      infoTooltip: 'Real-time internet disruptions and outages tracked via NetBlocks and IODA feeds.',
    });
    this.showLoading('Loading internet outage data…');
  }

  public setOutageClickHandler(handler: (lat: number, lon: number) => void): void {
    this.onOutageClick = handler;
  }

  public setOutages(outages: InternetOutage[]): void {
    this.outages = outages;
    this.setCount(outages.length);
    this.render();
  }

  private render(): void {
    if (!this.outages.length) {
      this.content.innerHTML = '<div style="text-align:center;padding:1.5rem;color:var(--text-secondary,#94a3b8)">No active internet outages</div>';
      return;
    }

    // Severity distribution
    const sevCount: Record<string, number> = { total: 0, major: 0, partial: 0 };
    for (const o of this.outages) sevCount[o.severity] = (sevCount[o.severity] ?? 0) + 1;

    // Group by country
    const byCountry = new Map<string, InternetOutage[]>();
    for (const o of this.outages) {
      const c = o.country || 'Unknown';
      if (!byCountry.has(c)) byCountry.set(c, []);
      byCountry.get(c)!.push(o);
    }
    const topCountries = [...byCountry.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 6);

    let html = '<div class="iop-overview">';

    // Severity bar
    const total = this.outages.length;
    html += '<div class="iop-sev-bar">';
    for (const sev of ['total', 'major', 'partial']) {
      const cnt = sevCount[sev] ?? 0;
      if (cnt === 0) continue;
      const pct = (cnt / total * 100).toFixed(1);
      html += `<div class="iop-sev-seg" style="width:${pct}%;background:${SEV_COLORS[sev]}" title="${SEV_LABELS[sev]}: ${cnt}"></div>`;
    }
    html += '</div>';

    // Severity pills
    html += '<div class="iop-pills">';
    for (const sev of ['total', 'major', 'partial']) {
      const cnt = sevCount[sev] ?? 0;
      if (cnt === 0) continue;
      html += `<span class="iop-pill" style="color:${SEV_COLORS[sev]}">${SEV_LABELS[sev]} ${cnt}</span>`;
    }
    html += '</div>';

    // By country
    for (const [country, outages] of topCountries) {
      const totalCount = outages.filter(o => o.severity === 'total').length;
      const borderColor = totalCount > 0 ? '#ef4444' : outages.some(o => o.severity === 'major') ? '#f97316' : '#94a3b8';
      html += `<div class="iop-country">
        <div class="iop-country-head" style="border-left:3px solid ${borderColor}">
          ${escapeHtml(country)} <span class="iop-country-count">${outages.length}</span>
          ${totalCount > 0 ? `<span class="iop-total-badge">${totalCount} total</span>` : ''}
        </div>`;

      const sorted = [...outages].sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime());
      for (const o of sorted.slice(0, 2)) {
        const sc = SEV_COLORS[o.severity] ?? '#64748b';
        const ago = timeAgo(o.pubDate instanceof Date ? o.pubDate : new Date(o.pubDate));
        const cause = o.cause ? ` — ${escapeHtml(o.cause)}` : '';
        const hasCoords = o.lat !== 0 || o.lon !== 0;
        html += `<div class="iop-row${hasCoords ? ' iop-clickable' : ''}" data-lat="${o.lat}" data-lon="${o.lon}">
          <span class="iop-sev-dot" style="background:${sc}"></span>
          <span class="iop-title">${escapeHtml(o.title.slice(0, 55))}${o.title.length > 55 ? '…' : ''}${cause}</span>
          <span class="iop-ago">${ago}</span>
        </div>`;
      }

      if (outages.length > 2) {
        html += `<div class="iop-more">+${outages.length - 2} more outages</div>`;
      }
      html += '</div>';
    }

    if (byCountry.size > 6) {
      html += `<div class="iop-footer">+${byCountry.size - 6} more countries</div>`;
    }

    html += '</div>';
    this.content.innerHTML = html;

    // Click handlers
    this.content.querySelectorAll<HTMLElement>('.iop-clickable').forEach(el => {
      el.addEventListener('click', () => {
        const lat = parseFloat(el.dataset.lat ?? '0');
        const lon = parseFloat(el.dataset.lon ?? '0');
        if (lat !== 0 || lon !== 0) this.onOutageClick?.(lat, lon);
      });
    });
  }
}
