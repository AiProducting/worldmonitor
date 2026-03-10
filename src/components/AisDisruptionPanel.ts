import { Panel } from './Panel';
import type { AisDisruptionEvent, AisDensityZone } from '@/types';

const SEV_COLORS: Record<string, string> = {
  high: '#ef4444', elevated: '#f97316', low: '#22c55e',
};
const SEV_ORDER: Record<string, number> = {
  high: 0, elevated: 1, low: 2,
};
const TYPE_LABELS: Record<string, string> = {
  gap_spike: 'AIS Gap', chokepoint_congestion: 'Congestion',
};

export class AisDisruptionPanel extends Panel {
  private clickHandler?: (lat: number, lon: number) => void;

  constructor() {
    super({ id: 'ais-disruptions', title: 'Maritime Disruptions', showCount: true, trackActivity: true });
  }

  setClickHandler(handler: (lat: number, lon: number) => void): void {
    this.clickHandler = handler;
  }

  setData(disruptions: AisDisruptionEvent[], density: AisDensityZone[]): void {
    const total = disruptions.length + density.length;
    this.setCount(total);

    if (!total) {
      this.content.innerHTML = '<div class="aid-empty">No active maritime disruptions</div>';
      return;
    }

    // Sort disruptions by severity
    const sorted = [...disruptions].sort((a, b) => {
      const sd = (SEV_ORDER[a.severity] ?? 2) - (SEV_ORDER[b.severity] ?? 2);
      if (sd !== 0) return sd;
      return Math.abs(b.changePct) - Math.abs(a.changePct);
    });

    // Severity summary bar
    const counts: Record<string, number> = {};
    for (const d of sorted) counts[d.severity] = (counts[d.severity] ?? 0) + 1;

    let html = '';
    if (sorted.length) {
      html += '<div class="aid-bar">';
      for (const sev of ['high', 'elevated', 'low']) {
        const n = counts[sev] ?? 0;
        if (!n) continue;
        const pct = (n / sorted.length) * 100;
        html += `<div class="aid-bar-seg" style="width:${pct}%;background:${SEV_COLORS[sev] ?? '#64748b'}" title="${sev}: ${n}"></div>`;
      }
      html += '</div>';

      // Severity pills
      html += '<div class="aid-pills">';
      for (const sev of ['high', 'elevated', 'low']) {
        const n = counts[sev] ?? 0;
        if (!n) continue;
        const c = SEV_COLORS[sev] ?? '#64748b';
        html += `<span class="aid-pill" style="background:${c}20;color:${c}">${sev.charAt(0).toUpperCase() + sev.slice(1)} ${n}</span>`;
      }
      html += '</div>';

      // Disruption list (top 8)
      html += '<div class="aid-section-title">Disruptions</div>';
      for (const d of sorted.slice(0, 8)) {
        const c = SEV_COLORS[d.severity] ?? '#64748b';
        const chgC = d.changePct >= 0 ? '#ef4444' : '#22c55e';
        const typeLabel = TYPE_LABELS[d.type] ?? d.type;
        const region = d.region ? ` &middot; ${d.region}` : '';
        const dark = d.darkShips ? ` &middot; ${d.darkShips} dark` : '';
        html += `<div class="aid-row aid-clickable" data-lat="${d.lat}" data-lon="${d.lon}">
          <span class="aid-sev-dot" style="background:${c}"></span>
          <span class="aid-type" style="background:${c}20;color:${c}">${typeLabel}</span>
          <span class="aid-name">${d.name}</span>
          <span class="aid-chg" style="color:${chgC}">${d.changePct >= 0 ? '+' : ''}${d.changePct}%</span>
        </div>
        <div class="aid-meta">${d.windowHours}h window${region}${dark}</div>`;
      }
      if (sorted.length > 8) {
        html += `<div class="aid-more">+${sorted.length - 8} more disruptions</div>`;
      }
    }

    // Density zones (top 5)
    if (density.length) {
      const topDensity = [...density].sort((a, b) => Math.abs(b.deltaPct) - Math.abs(a.deltaPct)).slice(0, 5);
      html += '<div class="aid-section-title">Traffic Density</div>';
      for (const z of topDensity) {
        const dc = z.deltaPct >= 10 ? '#f97316' : z.deltaPct <= -10 ? '#22c55e' : '#64748b';
        const ships = z.shipsPerDay ? `${z.shipsPerDay}/day` : '';
        html += `<div class="aid-row aid-clickable" data-lat="${z.lat}" data-lon="${z.lon}">
          <span class="aid-density-bar" style="width:${Math.min(100, z.intensity)}%;background:${dc}"></span>
          <span class="aid-name">${z.name}</span>
          <span class="aid-chg" style="color:${dc}">${z.deltaPct >= 0 ? '+' : ''}${z.deltaPct}%</span>
        </div>`;
        if (ships || z.note) {
          html += `<div class="aid-meta">${[ships, z.note].filter(Boolean).join(' &middot; ')}</div>`;
        }
      }
      if (density.length > 5) {
        html += `<div class="aid-more">+${density.length - 5} more zones</div>`;
      }
    }

    this.content.innerHTML = html;

    // Click-to-fly
    if (this.clickHandler) {
      this.content.querySelectorAll('.aid-clickable').forEach(el => {
        el.addEventListener('click', () => {
          const lat = parseFloat((el as HTMLElement).dataset.lat ?? '0');
          const lon = parseFloat((el as HTMLElement).dataset.lon ?? '0');
          if (lat || lon) this.clickHandler!(lat, lon);
        });
      });
    }
  }
}
