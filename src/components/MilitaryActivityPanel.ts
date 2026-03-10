import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import type {
  MilitaryFlight,
  MilitaryVessel,
  MilitaryAircraftType,
  MilitaryVesselType,
  MilitaryOperator,
} from '@/types';

/* ─── Label maps ──────────────────────────── */

const AIRCRAFT_LABELS: Record<MilitaryAircraftType, string> = {
  fighter: 'Fighters', bomber: 'Bombers', transport: 'Transport',
  tanker: 'Tankers', awacs: 'AWACS', reconnaissance: 'Recon',
  helicopter: 'Helicopters', drone: 'Drones', patrol: 'Patrol',
  special_ops: 'Special Ops', vip: 'VIP', unknown: 'Unknown',
};

const AIRCRAFT_ICONS: Record<MilitaryAircraftType, string> = {
  fighter: '✈️', bomber: '💣', transport: '🛬', tanker: '⛽',
  awacs: '📡', reconnaissance: '🔭', helicopter: '🚁', drone: '🛸',
  patrol: '🛩️', special_ops: '🎯', vip: '👔', unknown: '❓',
};

const VESSEL_LABELS: Record<MilitaryVesselType, string> = {
  carrier: 'Carriers', destroyer: 'Destroyers', frigate: 'Frigates',
  submarine: 'Submarines', amphibious: 'Amphibious', patrol: 'Patrol',
  auxiliary: 'Auxiliary', research: 'Research', icebreaker: 'Icebreakers',
  special: 'Special', unknown: 'Unknown',
};

const VESSEL_ICONS: Record<MilitaryVesselType, string> = {
  carrier: '🛳️', destroyer: '⚓', frigate: '🚢', submarine: '🫧',
  amphibious: '🏖️', patrol: '🔱', auxiliary: '📦', research: '🔬',
  icebreaker: '🧊', special: '🎖️', unknown: '❓',
};

const OPERATOR_FLAGS: Record<MilitaryOperator | 'other', string> = {
  usaf: '🇺🇸', usn: '🇺🇸', usmc: '🇺🇸', usa: '🇺🇸',
  raf: '🇬🇧', rn: '🇬🇧', faf: '🇫🇷', gaf: '🇩🇪',
  plaaf: '🇨🇳', plan: '🇨🇳', vks: '🇷🇺', iaf: '🇮🇱',
  nato: '🏳️', other: '🌐',
};

function timeAgo(d: Date): string {
  const diffMs = Date.now() - d.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export class MilitaryActivityPanel extends Panel {
  private flights: MilitaryFlight[] = [];
  private vessels: MilitaryVessel[] = [];
  private onAssetClick?: (lat: number, lon: number) => void;

  constructor() {
    super({
      id: 'military-activity',
      title: 'Military Activity',
      showCount: true,
      trackActivity: true,
      infoTooltip: 'Live military aircraft and naval vessel tracking from ADS-B and AIS feeds.',
    });
    this.showLoading('Loading military activity data…');
  }

  public setAssetClickHandler(handler: (lat: number, lon: number) => void): void {
    this.onAssetClick = handler;
  }

  public setData(flights: MilitaryFlight[], vessels: MilitaryVessel[]): void {
    this.flights = flights;
    this.vessels = vessels;
    this.setCount(flights.length + vessels.length);
    this.render();
  }

  private render(): void {
    const totalAssets = this.flights.length + this.vessels.length;
    if (totalAssets === 0) {
      this.content.innerHTML = '<div style="text-align:center;padding:1.5rem;color:var(--text-secondary,#94a3b8)">No military activity detected</div>';
      return;
    }

    let html = '<div class="mil-overview">';

    // Summary bar: flights vs vessels
    const flightPct = totalAssets > 0 ? (this.flights.length / totalAssets * 100).toFixed(1) : '0';
    const vesselPct = totalAssets > 0 ? (this.vessels.length / totalAssets * 100).toFixed(1) : '0';
    html += `<div class="mil-summary">
      <span class="mil-stat"><span class="mil-stat-icon">✈️</span> ${this.flights.length} flights</span>
      <span class="mil-stat"><span class="mil-stat-icon">🚢</span> ${this.vessels.length} vessels</span>
    </div>`;
    html += '<div class="mil-split-bar">';
    html += `<div class="mil-split-seg mil-seg-air" style="width:${flightPct}%" title="Flights: ${this.flights.length}"></div>`;
    html += `<div class="mil-split-seg mil-seg-sea" style="width:${vesselPct}%" title="Vessels: ${this.vessels.length}"></div>`;
    html += '</div>';

    // --- Aircraft section ---
    if (this.flights.length > 0) {
      // Aircraft type distribution
      const acTypeCount = new Map<MilitaryAircraftType, number>();
      for (const f of this.flights) {
        acTypeCount.set(f.aircraftType, (acTypeCount.get(f.aircraftType) ?? 0) + 1);
      }
      html += '<div class="mil-section-label">✈️ Aircraft by Type</div>';
      html += '<div class="mil-pills">';
      const sortedTypes = [...acTypeCount.entries()].sort((a, b) => b[1] - a[1]);
      for (const [type, count] of sortedTypes.slice(0, 6)) {
        const icon = AIRCRAFT_ICONS[type] ?? '❓';
        html += `<span class="mil-pill">${icon} ${AIRCRAFT_LABELS[type] ?? type} ${count}</span>`;
      }
      html += '</div>';

      // Top operators
      const opCount = new Map<string, number>();
      for (const f of this.flights) {
        const key = f.operator;
        opCount.set(key, (opCount.get(key) ?? 0) + 1);
      }
      const topOps = [...opCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
      html += '<div class="mil-section-label">Top Operators</div>';
      for (const [op, count] of topOps) {
        const flag = OPERATOR_FLAGS[op as MilitaryOperator] ?? '🌐';
        const pct = (count / this.flights.length * 100).toFixed(0);
        html += `<div class="mil-op-row">
          <span class="mil-op-flag">${flag}</span>
          <span class="mil-op-name">${op.toUpperCase()}</span>
          <div class="mil-op-bar-wrap"><div class="mil-op-bar" style="width:${pct}%"></div></div>
          <span class="mil-op-count">${count}</span>
        </div>`;
      }

      // Interesting flights (flagged)
      const interesting = this.flights.filter(f => f.isInteresting).slice(0, 3);
      if (interesting.length > 0) {
        html += '<div class="mil-section-label">⚠️ Notable Flights</div>';
        for (const f of interesting) {
          const flag = OPERATOR_FLAGS[f.operator] ?? '🌐';
          const icon = AIRCRAFT_ICONS[f.aircraftType] ?? '✈️';
          const ago = timeAgo(f.lastSeen instanceof Date ? f.lastSeen : new Date(f.lastSeen));
          const model = f.aircraftModel ? ` (${escapeHtml(f.aircraftModel)})` : '';
          html += `<div class="mil-row mil-clickable" data-lat="${f.lat}" data-lon="${f.lon}">
            <span class="mil-flag">${flag}</span>
            <span class="mil-flight-icon">${icon}</span>
            <span class="mil-callsign">${escapeHtml(f.callsign)}${model}</span>
            <span class="mil-alt">${Math.round(f.altitude / 1000)}k ft</span>
            <span class="mil-ago">${ago}</span>
          </div>`;
        }
      }
    }

    // --- Vessel section ---
    if (this.vessels.length > 0) {
      const vTypeCount = new Map<MilitaryVesselType, number>();
      for (const v of this.vessels) {
        vTypeCount.set(v.vesselType, (vTypeCount.get(v.vesselType) ?? 0) + 1);
      }
      html += '<div class="mil-section-label">🚢 Vessels by Type</div>';
      html += '<div class="mil-pills">';
      const sortedVTypes = [...vTypeCount.entries()].sort((a, b) => b[1] - a[1]);
      for (const [type, count] of sortedVTypes.slice(0, 6)) {
        const icon = VESSEL_ICONS[type] ?? '❓';
        html += `<span class="mil-pill">${icon} ${VESSEL_LABELS[type] ?? type} ${count}</span>`;
      }
      html += '</div>';

      // Dark vessels (AIS disabled)
      const darkVessels = this.vessels.filter(v => v.isDark).slice(0, 3);
      if (darkVessels.length > 0) {
        html += `<div class="mil-section-label">🔇 Dark Vessels (AIS off) — ${this.vessels.filter(v => v.isDark).length} total</div>`;
        for (const v of darkVessels) {
          const flag = OPERATOR_FLAGS[v.operator as MilitaryOperator] ?? '🌐';
          const icon = VESSEL_ICONS[v.vesselType] ?? '🚢';
          const ago = timeAgo(v.lastAisUpdate instanceof Date ? v.lastAisUpdate : new Date(v.lastAisUpdate));
          const hull = v.hullNumber ? ` (${escapeHtml(v.hullNumber)})` : '';
          html += `<div class="mil-row mil-clickable" data-lat="${v.lat}" data-lon="${v.lon}">
            <span class="mil-flag">${flag}</span>
            <span class="mil-flight-icon">${icon}</span>
            <span class="mil-callsign">${escapeHtml(v.name)}${hull}</span>
            ${v.nearChokepoint ? `<span class="mil-choke">📍 ${escapeHtml(v.nearChokepoint)}</span>` : ''}
            <span class="mil-ago">${ago}</span>
          </div>`;
        }
      }

      // Notable vessels (interesting flagged)
      const notableVessels = this.vessels.filter(v => v.isInteresting && !v.isDark).slice(0, 3);
      if (notableVessels.length > 0) {
        html += '<div class="mil-section-label">⚠️ Notable Vessels</div>';
        for (const v of notableVessels) {
          const flag = OPERATOR_FLAGS[v.operator as MilitaryOperator] ?? '🌐';
          const icon = VESSEL_ICONS[v.vesselType] ?? '🚢';
          const ago = timeAgo(v.lastAisUpdate instanceof Date ? v.lastAisUpdate : new Date(v.lastAisUpdate));
          const hull = v.hullNumber ? ` (${escapeHtml(v.hullNumber)})` : '';
          html += `<div class="mil-row mil-clickable" data-lat="${v.lat}" data-lon="${v.lon}">
            <span class="mil-flag">${flag}</span>
            <span class="mil-flight-icon">${icon}</span>
            <span class="mil-callsign">${escapeHtml(v.name)}${hull}</span>
            <span class="mil-ago">${ago}</span>
          </div>`;
        }
      }
    }

    html += '</div>';
    this.content.innerHTML = html;

    // Click handlers for fly-to-asset
    this.content.querySelectorAll<HTMLElement>('.mil-clickable').forEach(el => {
      el.addEventListener('click', () => {
        const lat = parseFloat(el.dataset.lat ?? '0');
        const lon = parseFloat(el.dataset.lon ?? '0');
        if (lat !== 0 || lon !== 0) this.onAssetClick?.(lat, lon);
      });
    });
  }
}
