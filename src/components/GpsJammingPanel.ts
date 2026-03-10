import { Panel } from './Panel';
import type { GpsJamData } from '@/services/gps-interference';
import { getGpsInterferenceByRegion } from '@/services/gps-interference';

const LEVEL_COLORS: Record<string, string> = {
  high: '#ef4444', medium: '#f97316',
};

const REGION_LABELS: Record<string, string> = {
  'iran-iraq': 'Iran / Iraq',
  'levant': 'Levant',
  'israel-sinai': 'Israel / Sinai',
  'ukraine-russia': 'Ukraine / Russia',
  'russia-north': 'Russia North',
  'turkey-caucasus': 'Turkey / Caucasus',
  'afghanistan-pakistan': 'Afghanistan / Pakistan',
  'yemen-horn': 'Yemen / Horn of Africa',
  'northern-europe': 'Northern Europe',
  'western-europe': 'Western Europe',
  'north-america': 'North America',
  'other': 'Other',
};

export class GpsJammingPanel extends Panel {
  private clickHandler?: (lat: number, lon: number) => void;

  constructor() {
    super({ id: 'gps-jamming', title: 'GPS/GNSS Interference', showCount: true, trackActivity: true });
  }

  setClickHandler(handler: (lat: number, lon: number) => void): void {
    this.clickHandler = handler;
  }

  setData(data: GpsJamData): void {
    const { stats, hexes } = data;
    this.setCount(stats.totalHexes);

    if (!hexes.length) {
      this.content.innerHTML = '<div class="gpj-empty">No GPS interference detected</div>';
      return;
    }

    // Level summary bar
    const total = stats.totalHexes || 1;
    const highPct = (stats.highCount / total) * 100;
    const medPct = (stats.mediumCount / total) * 100;

    let html = `<div class="gpj-bar">
      <div class="gpj-bar-seg" style="width:${highPct}%;background:${LEVEL_COLORS.high}" title="High: ${stats.highCount}"></div>
      <div class="gpj-bar-seg" style="width:${medPct}%;background:${LEVEL_COLORS.medium}" title="Medium: ${stats.mediumCount}"></div>
    </div>`;

    // Level pills
    html += '<div class="gpj-pills">';
    html += `<span class="gpj-pill" style="background:#ef444420;color:#ef4444">High ${stats.highCount}</span>`;
    html += `<span class="gpj-pill" style="background:#f9731620;color:#f97316">Medium ${stats.mediumCount}</span>`;
    html += `<span class="gpj-pill" style="background:#64748b20;color:#94a3b8">Total ${stats.totalHexes}</span>`;
    html += '</div>';

    // Regional breakdown
    const regions = getGpsInterferenceByRegion(data);
    const regionEntries = Object.entries(regions)
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 8);

    html += '<div class="gpj-regions">';
    for (const [region, regionHexes] of regionEntries) {
      const label = REGION_LABELS[region] ?? region;
      const highInRegion = regionHexes.filter(h => h.level === 'high').length;
      const c = highInRegion > 0 ? LEVEL_COLORS.high : LEVEL_COLORS.medium;

      // Find centroid for click-to-fly
      const centLat = regionHexes.reduce((s, h) => s + h.lat, 0) / regionHexes.length;
      const centLon = regionHexes.reduce((s, h) => s + h.lon, 0) / regionHexes.length;

      html += `<div class="gpj-region" data-lat="${centLat.toFixed(4)}" data-lon="${centLon.toFixed(4)}">
        <div class="gpj-region-hdr">
          <span class="gpj-region-dot" style="background:${c}"></span>
          <span class="gpj-region-name">${label}</span>
          <span class="gpj-region-count">${regionHexes.length} hex</span>
        </div>
        <div class="gpj-region-bar">
          <div class="gpj-region-fill" style="width:${(regionHexes.length / hexes.length) * 100}%;background:${c}"></div>
        </div>
      </div>`;
    }
    html += '</div>';

    // Top interference hexes by npAvg
    const sorted = [...hexes].sort((a, b) => b.npAvg - a.npAvg).slice(0, 6);
    html += '<div class="gpj-hotspots"><div class="gpj-hotspots-title">Top Interference</div>';
    for (const hex of sorted) {
      const c = LEVEL_COLORS[hex.level] ?? '#64748b';
      html += `<div class="gpj-hex" data-lat="${hex.lat}" data-lon="${hex.lon}">
        <span class="gpj-hex-level" style="color:${c}">${hex.level.toUpperCase()}</span>
        <span class="gpj-hex-coord">${hex.lat.toFixed(1)}°, ${hex.lon.toFixed(1)}°</span>
        <span class="gpj-hex-np">NP ${hex.npAvg.toFixed(1)}</span>
        <span class="gpj-hex-ac">${hex.aircraftCount} a/c</span>
      </div>`;
    }
    html += '</div>';

    // Timestamp
    if (data.fetchedAt) {
      const time = new Date(data.fetchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      html += `<div class="gpj-timestamp">Updated ${time} · ${data.source}</div>`;
    }

    this.content.innerHTML = html;

    // Attach click handlers for fly-to
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
