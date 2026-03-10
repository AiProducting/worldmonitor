import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import type { Earthquake } from '@/services/earthquakes';
import { t } from '@/services/i18n';

const MAG_THRESHOLDS = [
  { min: 7.0, label: 'Major',    cls: 'seis-major',    icon: '🟥' },
  { min: 6.0, label: 'Strong',   cls: 'seis-strong',   icon: '🟧' },
  { min: 5.0, label: 'Moderate', cls: 'seis-moderate', icon: '🟨' },
  { min: 4.0, label: 'Light',    cls: 'seis-light',    icon: '🟩' },
  { min: 0.0, label: 'Minor',    cls: 'seis-minor',    icon: '⬜' },
];

function getMagCategory(mag: number) {
  return MAG_THRESHOLDS.find(t => mag >= t.min) ?? MAG_THRESHOLDS[MAG_THRESHOLDS.length - 1]!;
}

function magColor(mag: number): string {
  if (mag >= 7.0) return '#ef4444';
  if (mag >= 6.0) return '#f97316';
  if (mag >= 5.0) return '#f59e0b';
  if (mag >= 4.0) return '#22c55e';
  return '#64748b';
}

function timeAgo(timestamp: number): string {
  const diffMs = Date.now() - timestamp; // occurredAt is already in ms
  const mins = Math.floor(diffMs / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export class SeismologyPanel extends Panel {
  private earthquakes: Earthquake[] = [];
  private onQuakeClick?: (lat: number, lon: number) => void;

  constructor() {
    super({
      id: 'seismology',
      title: 'Seismology',
      showCount: true,
      trackActivity: true,
      infoTooltip: 'Recent significant earthquakes from USGS. Magnitude ≥ 4.5 shown.',
    });
    this.showLoading('Loading earthquake data…');
  }

  public setQuakeClickHandler(handler: (lat: number, lon: number) => void): void {
    this.onQuakeClick = handler;
  }

  public setEarthquakes(earthquakes: Earthquake[]): void {
    this.earthquakes = earthquakes;
    this.renderContent();
  }

  private renderContent(): void {
    // Show M ≥ 4.5, sorted by magnitude descending, cap at 50
    const significant = [...this.earthquakes]
      .filter(eq => eq.magnitude >= 4.5)
      .sort((a, b) => b.magnitude - a.magnitude)
      .slice(0, 50);

    this.setCount(significant.length);

    if (significant.length === 0) {
      this.setContent(`<div class="panel-empty">No significant earthquakes (M ≥ 4.5) in current data.</div>`);
      return;
    }

    // Summary stats
    const major   = significant.filter(e => e.magnitude >= 7.0).length;
    const strong  = significant.filter(e => e.magnitude >= 6.0 && e.magnitude < 7.0).length;
    const moder   = significant.filter(e => e.magnitude >= 5.0 && e.magnitude < 6.0).length;
    const maxMag  = significant[0]!.magnitude;
    const maxQuake = significant[0]!;

    const summaryHtml = `
      <div class="seis-summary">
        <div class="seis-stat seis-major-stat">
          <span class="seis-stat-num">${major}</span>
          <span class="seis-stat-lbl">Major (M7+)</span>
        </div>
        <div class="seis-stat seis-strong-stat">
          <span class="seis-stat-num">${strong}</span>
          <span class="seis-stat-lbl">Strong (M6+)</span>
        </div>
        <div class="seis-stat seis-moderate-stat">
          <span class="seis-stat-num">${moder}</span>
          <span class="seis-stat-lbl">Moderate (M5+)</span>
        </div>
        <div class="seis-stat seis-max-stat">
          <span class="seis-stat-num" style="color:${magColor(maxMag)}">${maxMag.toFixed(1)}</span>
          <span class="seis-stat-lbl">Max Mag</span>
        </div>
      </div>
    `;

    // Largest event highlight
    const topCat = getMagCategory(maxMag)!;
    const topHighlight = `
      <div class="seis-top-event ${topCat.cls}-row" data-lat="${maxQuake.location?.latitude ?? 0}" data-lon="${maxQuake.location?.longitude ?? 0}">
        <div class="seis-top-mag" style="color:${magColor(maxMag)}">M ${maxMag.toFixed(1)}</div>
        <div class="seis-top-info">
          <div class="seis-top-place">${escapeHtml(maxQuake.place)}</div>
          <div class="seis-top-meta">${topCat.label} · ${maxQuake.depthKm.toFixed(0)} km depth · ${timeAgo(maxQuake.occurredAt)}</div>
        </div>
      </div>
    `;

    // List rows
    const rows = significant.slice(0, 25).map(eq => {
      const cat = getMagCategory(eq.magnitude)!;
      const mc  = magColor(eq.magnitude);
      const lat = eq.location?.latitude ?? 0;
      const lon = eq.location?.longitude ?? 0;
      return `<tr class="seis-row ${cat.cls}-row" data-lat="${lat}" data-lon="${lon}">
        <td class="seis-mag-cell">
          <span class="seis-mag-badge" style="background:${mc}22;color:${mc};border-color:${mc}44">
            M ${eq.magnitude.toFixed(1)}
          </span>
        </td>
        <td class="seis-place">${escapeHtml(eq.place)}</td>
        <td class="seis-depth">${eq.depthKm.toFixed(0)} km</td>
        <td class="seis-time">${timeAgo(eq.occurredAt)}</td>
      </tr>`;
    }).join('');

    this.setContent(`
      <div class="seis-wrap">
        ${summaryHtml}
        ${topHighlight}
        <div class="seis-table-wrap">
          <table class="seis-table">
            <thead>
              <tr>
                <th>Mag</th>
                <th>Location</th>
                <th>Depth</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        <div class="seis-footer">
          ${t('common.source')}: USGS Earthquake Hazards Program · M ≥ 4.5 shown
        </div>
      </div>
    `);

    // Click handlers — zoom map to quake location
    this.content.querySelectorAll('.seis-row, .seis-top-event').forEach(el => {
      el.addEventListener('click', () => {
        const lat = Number((el as HTMLElement).dataset.lat);
        const lon = Number((el as HTMLElement).dataset.lon);
        if (Number.isFinite(lat) && Number.isFinite(lon)) {
          this.onQuakeClick?.(lat, lon);
        }
      });
    });
  }
}
