import { Panel } from './Panel';
import type { WeatherAlert } from '@/services/weather';

const SEV_COLORS: Record<string, string> = {
  Extreme: '#ef4444', Severe: '#f97316', Moderate: '#eab308',
  Minor: '#22c55e', Unknown: '#64748b',
};
const SEV_ORDER: Record<string, number> = {
  Extreme: 0, Severe: 1, Moderate: 2, Minor: 3, Unknown: 4,
};

export class WeatherAlertPanel extends Panel {
  private clickHandler?: (lat: number, lon: number) => void;

  constructor() {
    super({ id: 'weather-alerts', title: 'Weather Alerts', showCount: true, trackActivity: true });
  }

  setAlertClickHandler(handler: (lat: number, lon: number) => void): void {
    this.clickHandler = handler;
  }

  setAlerts(alerts: WeatherAlert[]): void {
    this.setCount(alerts.length);
    if (!alerts.length) {
      this.content.innerHTML = '<div class="wap-empty">No active weather alerts</div>';
      return;
    }

    // Sort by severity then onset
    const sorted = [...alerts].sort((a, b) => {
      const sd = (SEV_ORDER[a.severity] ?? 4) - (SEV_ORDER[b.severity] ?? 4);
      if (sd !== 0) return sd;
      return new Date(b.onset).getTime() - new Date(a.onset).getTime();
    });

    // Severity summary bar
    const counts: Record<string, number> = {};
    for (const a of sorted) counts[a.severity] = (counts[a.severity] ?? 0) + 1;
    const total = sorted.length;

    let html = '<div class="wap-bar">';
    for (const sev of ['Extreme', 'Severe', 'Moderate', 'Minor', 'Unknown']) {
      const n = counts[sev] ?? 0;
      if (!n) continue;
      const pct = (n / total) * 100;
      html += `<div class="wap-bar-seg" style="width:${pct}%;background:${SEV_COLORS[sev] ?? '#64748b'}" title="${sev}: ${n}"></div>`;
    }
    html += '</div>';

    // Severity pills
    html += '<div class="wap-pills">';
    for (const sev of ['Extreme', 'Severe', 'Moderate', 'Minor', 'Unknown']) {
      const n = counts[sev] ?? 0;
      if (!n) continue;
      const c = SEV_COLORS[sev] ?? '#64748b';
      html += `<span class="wap-pill" style="background:${c}20;color:${c}">${sev} ${n}</span>`;
    }
    html += '</div>';

    // Group by event type
    const byEvent = new Map<string, WeatherAlert[]>();
    for (const a of sorted) {
      const arr = byEvent.get(a.event) ?? [];
      arr.push(a);
      byEvent.set(a.event, arr);
    }

    // Sort event groups by worst severity
    const eventGroups = [...byEvent.entries()].sort((a, b) => {
      const wa = Math.min(...a[1].map(x => SEV_ORDER[x.severity] ?? 4));
      const wb = Math.min(...b[1].map(x => SEV_ORDER[x.severity] ?? 4));
      return wa - wb || b[1].length - a[1].length;
    });

    // Show top 8 event groups
    for (const [event, items] of eventGroups.slice(0, 8)) {
      const worstSev = items.reduce((w, a) => (SEV_ORDER[a.severity] ?? 4) < (SEV_ORDER[w] ?? 4) ? a.severity : w, 'Unknown');
      const c = SEV_COLORS[worstSev] ?? '#64748b';
      html += `<div class="wap-group">
        <div class="wap-group-hdr">
          <span class="wap-sev-dot" style="background:${c}"></span>
          <span class="wap-event">${event}</span>
          <span class="wap-group-count">${items.length}</span>
        </div>`;

      // Show top 3 alerts per group
      for (const a of items.slice(0, 3)) {
        const ac = SEV_COLORS[a.severity] ?? '#64748b';
        const area = a.areaDesc.length > 50 ? a.areaDesc.slice(0, 47) + '...' : a.areaDesc;
        const hasLoc = a.centroid && a.centroid[0] !== 0 && a.centroid[1] !== 0;
        html += `<div class="wap-alert${hasLoc ? ' wap-clickable' : ''}" ${hasLoc ? `data-lat="${a.centroid![0]}" data-lon="${a.centroid![1]}"` : ''}>
          <span class="wap-alert-sev" style="color:${ac}">${a.severity.charAt(0)}</span>
          <span class="wap-alert-area">${area}</span>
        </div>`;
      }
      if (items.length > 3) {
        html += `<div class="wap-more">+${items.length - 3} more</div>`;
      }
      html += '</div>';
    }

    if (eventGroups.length > 8) {
      html += `<div class="wap-more">+${eventGroups.length - 8} more event types</div>`;
    }

    this.content.innerHTML = html;

    // click-to-fly
    if (this.clickHandler) {
      this.content.querySelectorAll('.wap-clickable').forEach(el => {
        el.addEventListener('click', () => {
          const lat = parseFloat((el as HTMLElement).dataset.lat ?? '0');
          const lon = parseFloat((el as HTMLElement).dataset.lon ?? '0');
          if (lat || lon) this.clickHandler!(lat, lon);
        });
      });
    }
  }
}
