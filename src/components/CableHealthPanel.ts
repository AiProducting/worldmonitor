import { Panel } from './Panel';
import type { CableHealthResponse } from '@/types';

const STATUS_COLORS: Record<string, string> = {
  fault: '#ef4444', degraded: '#f97316', ok: '#22c55e', unknown: '#64748b',
};
const STATUS_ORDER: Record<string, number> = {
  fault: 0, degraded: 1, unknown: 2, ok: 3,
};

export class CableHealthPanel extends Panel {
  constructor() {
    super({ id: 'cable-health', title: 'Undersea Cable Health', showCount: true, trackActivity: true });
  }

  setHealth(data: CableHealthResponse): void {
    const entries = Object.entries(data.cables);
    const faults = entries.filter(([, r]) => r.status === 'fault');
    const degraded = entries.filter(([, r]) => r.status === 'degraded');
    const alertCount = faults.length + degraded.length;
    this.setCount(alertCount);

    if (!entries.length) {
      this.content.innerHTML = '<div class="chp-empty">No cable health data available</div>';
      return;
    }

    // Status summary bar
    const counts: Record<string, number> = {};
    for (const [, r] of entries) counts[r.status] = (counts[r.status] ?? 0) + 1;

    let html = '<div class="chp-bar">';
    for (const status of ['fault', 'degraded', 'ok', 'unknown']) {
      const n = counts[status] ?? 0;
      if (!n) continue;
      const pct = (n / entries.length) * 100;
      html += `<div class="chp-bar-seg" style="width:${pct}%;background:${STATUS_COLORS[status] ?? '#64748b'}" title="${status}: ${n}"></div>`;
    }
    html += '</div>';

    // Status pills
    html += '<div class="chp-pills">';
    for (const status of ['fault', 'degraded', 'ok', 'unknown']) {
      const n = counts[status] ?? 0;
      if (!n) continue;
      const c = STATUS_COLORS[status] ?? '#64748b';
      const label = status.charAt(0).toUpperCase() + status.slice(1);
      html += `<span class="chp-pill" style="background:${c}20;color:${c}">${label} ${n}</span>`;
    }
    html += '</div>';

    // Sort: faults first, then degraded, then rest
    const sorted = [...entries].sort(([, a], [, b]) => {
      const sd = (STATUS_ORDER[a.status] ?? 3) - (STATUS_ORDER[b.status] ?? 3);
      if (sd !== 0) return sd;
      return a.score - b.score;
    });

    // Show cables with issues first, then top healthy by confidence
    const toShow = sorted.slice(0, 12);
    for (const [cableId, record] of toShow) {
      const c = STATUS_COLORS[record.status] ?? '#64748b';
      const name = this.formatCableName(cableId);
      const scoreBar = Math.min(100, Math.max(0, record.score));

      html += `<div class="chp-cable">
        <div class="chp-cable-hdr">
          <span class="chp-status-dot" style="background:${c}"></span>
          <span class="chp-cable-name">${name}</span>
          <span class="chp-status-label" style="color:${c}">${record.status.toUpperCase()}</span>
        </div>
        <div class="chp-score-row">
          <div class="chp-score-track">
            <div class="chp-score-fill" style="width:${scoreBar}%;background:${c}"></div>
          </div>
          <span class="chp-score-val">${record.score}</span>
        </div>`;

      // Show latest evidence if available
      if (record.evidence.length) {
        const latest = record.evidence[0];
        if (latest) html += `<div class="chp-evidence">${latest.summary}</div>`;
      }

      html += '</div>';
    }

    if (sorted.length > 12) {
      html += `<div class="chp-more">+${sorted.length - 12} more cables monitored</div>`;
    }

    // Timestamp
    if (data.generatedAt) {
      const time = new Date(data.generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      html += `<div class="chp-timestamp">Updated ${time}</div>`;
    }

    this.content.innerHTML = html;
  }

  private formatCableName(id: string): string {
    // Convert kebab-case IDs to readable names
    return id
      .split('-')
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }
}
