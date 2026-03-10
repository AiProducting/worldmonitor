import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import type { SocialUnrestEvent, ProtestEventType, ProtestSeverity } from '@/types';

const TYPE_LABELS: Record<ProtestEventType, string> = {
  protest: 'Protests',
  riot: 'Riots',
  strike: 'Strikes',
  demonstration: 'Demonstrations',
  civil_unrest: 'Civil Unrest',
};

const TYPE_ICONS: Record<ProtestEventType, string> = {
  protest: '✊',
  riot: '🔥',
  strike: '⚡',
  demonstration: '📢',
  civil_unrest: '⚠️',
};

const SEV_COLORS: Record<ProtestSeverity, string> = {
  high: '#ef4444',
  medium: '#f97316',
  low: '#64748b',
};

function timeAgo(d: Date): string {
  const diffMs = Date.now() - d.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export class SocialUnrestPanel extends Panel {
  private events: SocialUnrestEvent[] = [];
  private onEventClick?: (lat: number, lon: number) => void;

  constructor() {
    super({
      id: 'social-unrest',
      title: 'Social Unrest',
      showCount: true,
      trackActivity: true,
      infoTooltip: 'Global protests, riots, strikes and civil unrest from ACLED and GDELT feeds.',
    });
    this.showLoading('Loading social unrest data…');
  }

  public setEventClickHandler(handler: (lat: number, lon: number) => void): void {
    this.onEventClick = handler;
  }

  public setEvents(events: SocialUnrestEvent[]): void {
    this.events = events;
    this.setCount(events.length);
    this.render();
  }

  private render(): void {
    if (!this.events.length) {
      this.content.innerHTML = '<div style="text-align:center;padding:1.5rem;color:var(--text-secondary,#94a3b8)">No active unrest events</div>';
      return;
    }

    // Severity distribution
    const sevCount: Record<ProtestSeverity, number> = { high: 0, medium: 0, low: 0 };
    for (const e of this.events) sevCount[e.severity]++;

    // Group by country, sort by event count
    const byCountry = new Map<string, SocialUnrestEvent[]>();
    for (const e of this.events) {
      const c = e.country || 'Unknown';
      if (!byCountry.has(c)) byCountry.set(c, []);
      byCountry.get(c)!.push(e);
    }
    const topCountries = [...byCountry.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 6);

    // Type distribution
    const typeCount = new Map<ProtestEventType, number>();
    for (const e of this.events) {
      typeCount.set(e.eventType, (typeCount.get(e.eventType) ?? 0) + 1);
    }

    let html = '<div class="sup-overview">';

    // Severity bar
    const total = this.events.length;
    html += '<div class="sup-sev-bar">';
    for (const sev of ['high', 'medium', 'low'] as ProtestSeverity[]) {
      const cnt = sevCount[sev];
      if (cnt === 0) continue;
      const pct = (cnt / total * 100).toFixed(1);
      html += `<div class="sup-sev-seg" style="width:${pct}%;background:${SEV_COLORS[sev]}" title="${sev}: ${cnt}"></div>`;
    }
    html += '</div>';

    // Type pills
    html += '<div class="sup-pills">';
    for (const [type, count] of typeCount) {
      const icon = TYPE_ICONS[type] ?? '📋';
      html += `<span class="sup-pill">${icon} ${TYPE_LABELS[type] ?? type} ${count}</span>`;
    }
    html += '</div>';

    // Top countries with recent events
    for (const [country, events] of topCountries) {
      const highCount = events.filter(e => e.severity === 'high').length;
      const countryColor = highCount > 0 ? '#ef4444' : '#94a3b8';
      html += `<div class="sup-country">
        <div class="sup-country-head" style="border-left:3px solid ${countryColor}">
          ${escapeHtml(country)} <span class="sup-country-count">${events.length}</span>
          ${highCount > 0 ? `<span class="sup-high-badge">${highCount} high</span>` : ''}
        </div>`;

      // Show top 2 most recent events for this country
      const sorted = [...events].sort((a, b) => b.time.getTime() - a.time.getTime());
      for (const e of sorted.slice(0, 2)) {
        const sc = SEV_COLORS[e.severity];
        const icon = TYPE_ICONS[e.eventType] ?? '📋';
        const ago = timeAgo(e.time);
        const loc = e.city ? escapeHtml(e.city) : '';
        const hasCoords = e.lat !== 0 || e.lon !== 0;
        html += `<div class="sup-row${hasCoords ? ' sup-clickable' : ''}" data-lat="${e.lat}" data-lon="${e.lon}">
          <span class="sup-sev-dot" style="background:${sc}"></span>
          <span class="sup-icon">${icon}</span>
          <span class="sup-title">${escapeHtml(e.title.slice(0, 60))}${e.title.length > 60 ? '…' : ''}</span>
          ${loc ? `<span class="sup-loc">${loc}</span>` : ''}
          <span class="sup-ago">${ago}</span>
        </div>`;
      }

      if (events.length > 2) {
        html += `<div class="sup-more">+${events.length - 2} more events</div>`;
      }
      html += '</div>';
    }

    if (byCountry.size > 6) {
      html += `<div class="sup-footer">+${byCountry.size - 6} more countries</div>`;
    }

    html += '</div>';
    this.content.innerHTML = html;

    // Click handlers
    this.content.querySelectorAll<HTMLElement>('.sup-clickable').forEach(el => {
      el.addEventListener('click', () => {
        const lat = parseFloat(el.dataset.lat ?? '0');
        const lon = parseFloat(el.dataset.lon ?? '0');
        if (lat !== 0 || lon !== 0) this.onEventClick?.(lat, lon);
      });
    });
  }
}
