import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import type { CyberThreat, CyberThreatType, CyberThreatSeverity } from '@/types';

const TYPE_LABELS: Record<CyberThreatType, string> = {
  c2_server: 'C2 Server',
  malware_host: 'Malware Host',
  phishing: 'Phishing',
  malicious_url: 'Malicious URL',
};

const TYPE_ICONS: Record<CyberThreatType, string> = {
  c2_server: '🖥️',
  malware_host: '🦠',
  phishing: '🎣',
  malicious_url: '🔗',
};

const SEV_COLORS: Record<CyberThreatSeverity, string> = {
  critical: '#ef4444',
  high: '#f97316',
  medium: '#eab308',
  low: '#64748b',
};

const SEV_ORDER: CyberThreatSeverity[] = ['critical', 'high', 'medium', 'low'];

function timeAgo(iso: string | undefined): string {
  if (!iso) return '';
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

interface TypeGroup {
  type: CyberThreatType;
  threats: CyberThreat[];
}

export class CyberThreatPanel extends Panel {
  private threats: CyberThreat[] = [];
  private onThreatClick?: (lat: number, lon: number) => void;

  constructor() {
    super({
      id: 'cyber-threats',
      title: 'Cyber Threats',
      showCount: true,
      trackActivity: true,
      infoTooltip: 'Live cyber threat indicators — C2 servers, malware hosts, phishing, and malicious URLs from threat intelligence feeds.',
    });
    this.showLoading('Loading cyber threat data…');
  }

  public setThreatClickHandler(handler: (lat: number, lon: number) => void): void {
    this.onThreatClick = handler;
  }

  public setThreats(threats: CyberThreat[]): void {
    this.threats = threats;
    this.setCount(threats.length);
    this.render();
  }

  private render(): void {
    if (!this.threats.length) {
      this.content.innerHTML = '<div style="text-align:center;padding:1.5rem;color:var(--text-secondary,#94a3b8)">No active cyber threats</div>';
      return;
    }

    // Severity distribution
    const sevCount: Record<CyberThreatSeverity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const t of this.threats) sevCount[t.severity]++;

    // Group by type
    const groups = new Map<CyberThreatType, CyberThreat[]>();
    for (const t of this.threats) {
      if (!groups.has(t.type)) groups.set(t.type, []);
      groups.get(t.type)!.push(t);
    }

    const sorted: TypeGroup[] = [];
    for (const type of Object.keys(TYPE_LABELS) as CyberThreatType[]) {
      const items = groups.get(type);
      if (items && items.length > 0) {
        // Sort by severity then by lastSeen
        items.sort((a, b) => {
          const sa = SEV_ORDER.indexOf(a.severity);
          const sb = SEV_ORDER.indexOf(b.severity);
          if (sa !== sb) return sa - sb;
          return (b.lastSeen ?? '').localeCompare(a.lastSeen ?? '');
        });
        sorted.push({ type, threats: items });
      }
    }

    let html = '<div class="ctp-overview">';

    // Severity bar
    const total = this.threats.length;
    html += '<div class="ctp-sev-bar">';
    for (const sev of SEV_ORDER) {
      const cnt = sevCount[sev];
      if (cnt === 0) continue;
      const pct = (cnt / total * 100).toFixed(1);
      html += `<div class="ctp-sev-seg" style="width:${pct}%;background:${SEV_COLORS[sev]}" title="${sev}: ${cnt}"></div>`;
    }
    html += '</div>';

    // Severity pills
    html += '<div class="ctp-pills">';
    for (const sev of SEV_ORDER) {
      const cnt = sevCount[sev];
      if (cnt === 0) continue;
      html += `<span class="ctp-pill" style="border-color:${SEV_COLORS[sev]};color:${SEV_COLORS[sev]}">${sev.toUpperCase()} ${cnt}</span>`;
    }
    html += '</div>';

    // Type groups — show top 3 threats per type
    for (const g of sorted) {
      const label = TYPE_LABELS[g.type];
      const icon = TYPE_ICONS[g.type];
      html += `<div class="ctp-group">
        <div class="ctp-group-head">${icon} ${escapeHtml(label)} <span class="ctp-group-count">${g.threats.length}</span></div>`;

      for (const t of g.threats.slice(0, 3)) {
        const sc = SEV_COLORS[t.severity];
        const ago = timeAgo(t.lastSeen);
        const country = t.country ? ` · ${escapeHtml(t.country)}` : '';
        const family = t.malwareFamily ? ` · ${escapeHtml(t.malwareFamily)}` : '';
        const hasCoords = t.lat !== 0 || t.lon !== 0;
        html += `<div class="ctp-row${hasCoords ? ' ctp-clickable' : ''}" data-lat="${t.lat}" data-lon="${t.lon}">
          <span class="ctp-sev-dot" style="background:${sc}"></span>
          <span class="ctp-indicator">${escapeHtml(t.indicator)}</span>
          <span class="ctp-meta">${escapeHtml(t.source)}${country}${family}</span>
          ${ago ? `<span class="ctp-ago">${ago}</span>` : ''}
        </div>`;
      }

      if (g.threats.length > 3) {
        html += `<div class="ctp-more">+${g.threats.length - 3} more</div>`;
      }
      html += '</div>';
    }

    // Top targeted countries
    const countryCounts = new Map<string, number>();
    for (const t of this.threats) {
      if (t.country) countryCounts.set(t.country, (countryCounts.get(t.country) ?? 0) + 1);
    }
    const topCountries = [...countryCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    if (topCountries.length) {
      html += '<div class="ctp-countries"><span class="ctp-countries-label">Top targets:</span>';
      for (const [c, n] of topCountries) {
        html += ` <span class="ctp-country">${escapeHtml(c)} (${n})</span>`;
      }
      html += '</div>';
    }

    html += '</div>';
    this.content.innerHTML = html;

    // Click handler
    this.content.querySelectorAll<HTMLElement>('.ctp-clickable').forEach(el => {
      el.addEventListener('click', () => {
        const lat = parseFloat(el.dataset.lat ?? '0');
        const lon = parseFloat(el.dataset.lon ?? '0');
        if (lat !== 0 || lon !== 0) this.onThreatClick?.(lat, lon);
      });
    });
  }
}
