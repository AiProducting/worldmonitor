import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';
import type { NaturalEvent, NaturalEventCategory } from '@/types';
import { getNaturalEventIcon } from '@/services/eonet';

const CATEGORY_PRIORITY: NaturalEventCategory[] = [
  'severeStorms', 'wildfires', 'volcanoes', 'floods', 'landslides',
  'drought', 'tempExtremes', 'dustHaze', 'snow', 'seaLakeIce', 'waterColor', 'manmade',
];

const CATEGORY_LABELS: Partial<Record<NaturalEventCategory, string>> = {
  severeStorms: 'Severe Storms',
  wildfires: 'Wildfires',
  volcanoes: 'Volcanoes',
  floods: 'Floods',
  landslides: 'Landslides',
  drought: 'Drought',
  tempExtremes: 'Temp Extremes',
  dustHaze: 'Dust / Haze',
  snow: 'Snow',
  seaLakeIce: 'Sea & Lake Ice',
  waterColor: 'Water Color',
  manmade: 'Man-Made',
};

function severityColor(category: NaturalEventCategory): string {
  switch (category) {
    case 'severeStorms': return '#818cf8';
    case 'wildfires': return '#f97316';
    case 'volcanoes': return '#ef4444';
    case 'floods': return '#3b82f6';
    case 'landslides': return '#a78bfa';
    case 'drought': return '#eab308';
    case 'tempExtremes': return '#f43f5e';
    default: return '#64748b';
  }
}

function timeAgo(d: Date): string {
  const diffMs = Date.now() - d.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

interface CategoryGroup {
  category: NaturalEventCategory;
  events: NaturalEvent[];
  activeCount: number;
}

export class NaturalHazardsPanel extends Panel {
  private events: NaturalEvent[] = [];
  private onEventClick?: (lat: number, lon: number) => void;

  constructor() {
    super({
      id: 'natural-hazards',
      title: 'Natural Hazards',
      showCount: true,
      trackActivity: true,
      infoTooltip: 'Active natural events from NASA EONET — storms, fires, volcanoes, floods and more.',
    });
    this.showLoading('Loading natural hazard data…');
  }

  public setEventClickHandler(handler: (lat: number, lon: number) => void): void {
    this.onEventClick = handler;
  }

  public setEvents(events: NaturalEvent[]): void {
    this.events = events.filter(e => !e.closed);
    this.setCount(this.events.length);
    this.render();
  }

  private render(): void {
    if (!this.events.length) {
      this.content.innerHTML = '<div style="text-align:center;padding:1.5rem;color:var(--text-secondary,#94a3b8)">No active natural hazard events</div>';
      return;
    }

    // Group by category
    const groups = new Map<NaturalEventCategory, NaturalEvent[]>();
    for (const e of this.events) {
      const cat = e.category === 'earthquakes' ? 'earthquakes' : e.category;
      // Skip earthquakes — they have their own panel
      if (cat === 'earthquakes') continue;
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat)!.push(e);
    }

    // Sort categories by priority
    const sorted: CategoryGroup[] = [];
    for (const cat of CATEGORY_PRIORITY) {
      const evts = groups.get(cat);
      if (evts && evts.length > 0) {
        // Sort events within category by date (newest first)
        evts.sort((a, b) => b.date.getTime() - a.date.getTime());
        sorted.push({ category: cat, events: evts, activeCount: evts.length });
      }
    }

    let html = '<div class="nhp-overview">';

    // Summary bar — category pills with counts
    html += '<div class="nhp-pills">';
    for (const g of sorted) {
      const icon = getNaturalEventIcon(g.category);
      const c = severityColor(g.category);
      html += `<span class="nhp-pill" style="border-color:${c};color:${c}">${icon} ${g.activeCount}</span>`;
    }
    html += '</div>';

    // Detail rows — top 2 events per category (max 5 categories)
    for (const g of sorted.slice(0, 5)) {
      const label = CATEGORY_LABELS[g.category] ?? g.category;
      const icon = getNaturalEventIcon(g.category);
      const c = severityColor(g.category);
      html += `<div class="nhp-cat-header" style="color:${c}">${icon} ${escapeHtml(label)} <span class="nhp-cat-count">(${g.activeCount})</span></div>`;

      for (const e of g.events.slice(0, 2)) {
        const mag = e.magnitude != null && e.magnitudeUnit ? ` — ${e.magnitude} ${escapeHtml(e.magnitudeUnit)}` : '';
        const storm = e.stormName ? ` <strong>${escapeHtml(e.stormName)}</strong>` : '';
        html += `<div class="nhp-event" data-lat="${e.lat}" data-lon="${e.lon}">
          <span class="nhp-event-title">${escapeHtml(e.title)}${storm}${mag}</span>
          <span class="nhp-event-time">${timeAgo(e.date)}</span>
        </div>`;
      }
      if (g.events.length > 2) {
        html += `<div class="nhp-more">+${g.events.length - 2} more</div>`;
      }
    }

    html += '</div>';
    this.content.innerHTML = html;

    // Bind click handlers for fly-to
    if (this.onEventClick) {
      const handler = this.onEventClick;
      this.content.querySelectorAll<HTMLElement>('.nhp-event[data-lat]').forEach(el => {
        el.style.cursor = 'pointer';
        el.addEventListener('click', () => {
          const lat = parseFloat(el.dataset.lat ?? '0');
          const lon = parseFloat(el.dataset.lon ?? '0');
          handler(lat, lon);
        });
      });
    }
  }
}
