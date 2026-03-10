import { Panel } from './Panel';
import type { AirportDelayAlert, FlightDelaySeverity } from '@/services/aviation';

const SEV_COLORS: Record<FlightDelaySeverity, string> = {
  severe: '#ef4444', major: '#f97316', moderate: '#eab308', minor: '#3b82f6', normal: '#22c55e',
};
const SEV_ORDER: Record<FlightDelaySeverity, number> = {
  severe: 0, major: 1, moderate: 2, minor: 3, normal: 4,
};

const DELAY_TYPE_LABELS: Record<string, string> = {
  ground_stop: 'Ground Stop',
  ground_delay: 'Ground Delay',
  departure_delay: 'Dep Delay',
  arrival_delay: 'Arr Delay',
  closure: 'Closure',
  general: 'General',
};

export class FlightDelaysPanel extends Panel {
  private clickHandler?: (lat: number, lon: number) => void;

  constructor() {
    super({ id: 'flight-delays', title: 'Flight Delays', showCount: true, trackActivity: true });
  }

  setClickHandler(handler: (lat: number, lon: number) => void): void {
    this.clickHandler = handler;
  }

  setData(delays: AirportDelayAlert[]): void {
    this.setCount(delays.length);

    if (!delays.length) {
      this.content.innerHTML = '<div class="fdp-empty">No airport delays reported</div>';
      return;
    }

    // Severity counts
    const counts: Record<string, number> = {};
    for (const d of delays) counts[d.severity] = (counts[d.severity] ?? 0) + 1;

    // Severity bar
    let html = '<div class="fdp-bar">';
    for (const sev of ['severe', 'major', 'moderate', 'minor', 'normal'] as FlightDelaySeverity[]) {
      const n = counts[sev] ?? 0;
      if (!n) continue;
      const pct = (n / delays.length) * 100;
      html += `<div class="fdp-bar-seg" style="width:${pct}%;background:${SEV_COLORS[sev]}" title="${sev}: ${n}"></div>`;
    }
    html += '</div>';

    // Severity pills
    html += '<div class="fdp-pills">';
    for (const sev of ['severe', 'major', 'moderate', 'minor'] as FlightDelaySeverity[]) {
      const n = counts[sev] ?? 0;
      if (!n) continue;
      const c = SEV_COLORS[sev];
      html += `<span class="fdp-pill" style="background:${c}20;color:${c}">${sev.charAt(0).toUpperCase() + sev.slice(1)} ${n}</span>`;
    }
    html += '</div>';

    // Region summary
    const byRegion: Record<string, number> = {};
    for (const d of delays) byRegion[d.region] = (byRegion[d.region] ?? 0) + 1;
    html += '<div class="fdp-regions">';
    for (const [region, count] of Object.entries(byRegion).sort((a, b) => b[1] - a[1])) {
      html += `<span class="fdp-region">${region.toUpperCase()} ${count}</span>`;
    }
    html += '</div>';

    // Sort by severity then delay minutes
    const sorted = [...delays].sort((a, b) => {
      const sd = (SEV_ORDER[a.severity] ?? 4) - (SEV_ORDER[b.severity] ?? 4);
      if (sd !== 0) return sd;
      return b.avgDelayMinutes - a.avgDelayMinutes;
    });

    // Top 10 delays
    for (const d of sorted.slice(0, 10)) {
      const c = SEV_COLORS[d.severity] ?? '#64748b';
      const typeLabel = DELAY_TYPE_LABELS[d.delayType] ?? d.delayType;

      html += `<div class="fdp-delay" data-lat="${d.lat}" data-lon="${d.lon}">
        <div class="fdp-delay-hdr">
          <span class="fdp-iata" style="color:${c}">${d.iata}</span>
          <span class="fdp-name">${d.name}</span>
          <span class="fdp-sev" style="background:${c}20;color:${c}">${d.severity.toUpperCase()}</span>
        </div>
        <div class="fdp-delay-detail">
          <span class="fdp-type">${typeLabel}</span>
          <span class="fdp-avg">${d.avgDelayMinutes}min avg</span>
          ${d.reason ? `<span class="fdp-reason">${d.reason}</span>` : ''}
        </div>
      </div>`;
    }

    if (sorted.length > 10) {
      html += `<div class="fdp-more">+${sorted.length - 10} more airports delayed</div>`;
    }

    this.content.innerHTML = html;

    // Attach click handlers
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
