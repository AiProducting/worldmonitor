import { Panel } from './Panel';
import type { IranEvent } from '@/generated/client/worldmonitor/conflict/v1/service_client';

const SEV_COLORS: Record<string, string> = {
  critical: '#ef4444', high: '#f97316', medium: '#eab308', low: '#3b82f6',
};

const CAT_LABELS: Record<string, string> = {
  missile_strike: 'Missile Strike',
  drone_attack: 'Drone Attack',
  proxy_attack: 'Proxy Attack',
  naval_incident: 'Naval Incident',
  cyber_attack: 'Cyber Attack',
  military_operation: 'Military Op',
};

export class IranEventsPanel extends Panel {
  private clickHandler?: (lat: number, lon: number) => void;

  constructor() {
    super({ id: 'iran-events', title: 'Iran & Proxy Events', showCount: true, trackActivity: true });
  }

  setClickHandler(handler: (lat: number, lon: number) => void): void {
    this.clickHandler = handler;
  }

  setData(events: IranEvent[]): void {
    this.setCount(events.length);

    if (!events.length) {
      this.content.innerHTML = '<div class="irn-empty">No recent events tracked</div>';
      return;
    }

    // Severity counts
    const sevCounts: Record<string, number> = {};
    for (const e of events) {
      const s = (e.severity || 'medium').toLowerCase();
      sevCounts[s] = (sevCounts[s] ?? 0) + 1;
    }

    // Severity bar
    let html = '<div class="irn-bar">';
    for (const sev of ['critical', 'high', 'medium', 'low']) {
      const n = sevCounts[sev] ?? 0;
      if (!n) continue;
      const pct = (n / events.length) * 100;
      const c = SEV_COLORS[sev] ?? '#64748b';
      html += `<div class="irn-bar-seg" style="width:${pct}%;background:${c}" title="${sev}: ${n}"></div>`;
    }
    html += '</div>';

    // Severity pills
    html += '<div class="irn-pills">';
    for (const sev of ['critical', 'high', 'medium', 'low']) {
      const n = sevCounts[sev] ?? 0;
      if (!n) continue;
      const c = SEV_COLORS[sev] ?? '#64748b';
      html += `<span class="irn-pill" style="background:${c}20;color:${c}">${sev.charAt(0).toUpperCase() + sev.slice(1)} ${n}</span>`;
    }
    html += '</div>';

    // Category breakdown
    const catCounts: Record<string, number> = {};
    for (const e of events) {
      const cat = e.category || 'unknown';
      catCounts[cat] = (catCounts[cat] ?? 0) + 1;
    }
    html += '<div class="irn-cats">';
    for (const [cat, count] of Object.entries(catCounts).sort((a, b) => b[1] - a[1]).slice(0, 6)) {
      const label = CAT_LABELS[cat] ?? cat.replace(/_/g, ' ');
      html += `<span class="irn-cat">${label} ${count}</span>`;
    }
    html += '</div>';

    // Sort by timestamp descending
    const sorted = [...events].sort((a, b) => {
      const ta = Number(a.timestamp) || 0;
      const tb = Number(b.timestamp) || 0;
      return tb - ta;
    });

    // Event list
    for (const e of sorted.slice(0, 8)) {
      const c = SEV_COLORS[(e.severity || 'medium').toLowerCase()] ?? '#64748b';
      const catLabel = CAT_LABELS[e.category] ?? e.category?.replace(/_/g, ' ') ?? '';
      const ts = Number(e.timestamp);
      const timeStr = ts > 0 ? new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' }) : '';

      html += `<div class="irn-event" data-lat="${e.latitude}" data-lon="${e.longitude}">
        <div class="irn-event-hdr">
          <span class="irn-event-sev" style="color:${c}">${(e.severity || 'MED').toUpperCase()}</span>
          <span class="irn-event-title">${e.title}</span>
        </div>
        <div class="irn-event-meta">
          <span class="irn-event-cat">${catLabel}</span>
          <span class="irn-event-loc">${e.locationName}</span>
          ${timeStr ? `<span class="irn-event-time">${timeStr}</span>` : ''}
        </div>
      </div>`;
    }

    if (sorted.length > 8) {
      html += `<div class="irn-more">+${sorted.length - 8} more events</div>`;
    }

    this.content.innerHTML = html;

    // Click-to-fly
    if (this.clickHandler) {
      const handler = this.clickHandler;
      this.content.querySelectorAll('[data-lat][data-lon]').forEach(el => {
        (el as HTMLElement).style.cursor = 'pointer';
        el.addEventListener('click', () => {
          const lat = parseFloat(el.getAttribute('data-lat') ?? '0');
          const lon = parseFloat(el.getAttribute('data-lon') ?? '0');
          handler(lat, lon);
        });
      });
    }
  }
}
