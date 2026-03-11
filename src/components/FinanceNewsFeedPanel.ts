import { Panel } from './Panel';
import { t } from '@/services/i18n';
import { escapeHtml, sanitizeUrl } from '@/utils/sanitize';
import { NewsServiceClient } from '@/generated/client/worldmonitor/news/v1/service_client';
import type { NewsItem, CategoryBucket } from '@/generated/client/worldmonitor/news/v1/service_client';

// Human-readable labels + sort priority
const CATEGORY_META: Record<string, { label: string; icon: string; priority: number }> = {
  'markets':        { label: 'Markets',       icon: '📈', priority: 1 },
  'economy':        { label: 'Economy',        icon: '🌐', priority: 2 },
  'central-banks':  { label: 'Central Banks',  icon: '🏛️',priority: 3 },
  'crypto':         { label: 'Crypto',         icon: '₿',  priority: 4 },
  'commodities':    { label: 'Commodities',    icon: '🛢️', priority: 5 },
  'trade':          { label: 'Trade',          icon: '🚢', priority: 6 },
  'energy':         { label: 'Energy',         icon: '⚡', priority: 7 },
  'tech':           { label: 'Tech',           icon: '💻', priority: 8 },
  'real-estate':    { label: 'RE/REITs',       icon: '🏢', priority: 9 },
  'earnings':       { label: 'Earnings',       icon: '📊', priority: 10 },
};

type CategoryKey = string;

const newsClient = new NewsServiceClient('', { fetch: (...args) => globalThis.fetch(...args) });

function relTime(publishedAt: number): string {
  const diffMs = Date.now() - publishedAt * 1000;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 60)  return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24)   return `${diffHr}h ago`;
  return `${Math.floor(diffHr / 24)}d ago`;
}

export class FinanceNewsFeedPanel extends Panel {
  private categories: Record<string, CategoryBucket> = {};
  private loading = true;
  private error: string | null = null;
  private activeCategory: CategoryKey = 'markets';

  constructor() {
    super({ id: 'finance-news', title: t('panels.financeNews'), showCount: true });
    void this.fetchData();
  }

  public async fetchData(): Promise<void> {
    this.loading = true;
    this.error = null;
    this.renderPanel();
    try {
      const resp = await newsClient.listFeedDigest({ variant: 'finance', lang: 'en' });
      this.categories = resp.categories ?? {};
      this.loading = false;
      // Set badge with article count
      const total = Object.values(this.categories).reduce((s, b) => s + (b.items?.length ?? 0), 0);
      this.setDataBadge('live', `${total} articles`);
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to load news';
      this.loading = false;
    }
    if (!this.element?.isConnected) return;
    this.renderPanel();
    setTimeout(() => { if (this.element?.isConnected) void this.fetchData(); }, 5 * 60 * 1000);
  }

  private getAvailableCategories(): CategoryKey[] {
    const available = Object.keys(this.categories).filter(k => (this.categories[k]?.items?.length ?? 0) > 0);
    // Sort: known categories first by priority, then alphabetical
    return available.sort((a, b) => {
      const pa = CATEGORY_META[a]?.priority ?? 99;
      const pb = CATEGORY_META[b]?.priority ?? 99;
      if (pa !== pb) return pa - pb;
      return a.localeCompare(b);
    });
  }

  private getItems(): NewsItem[] {
    return this.categories[this.activeCategory]?.items ?? [];
  }

  protected renderPanel(): void {
    if (this.loading) { this.showLoading(); return; }
    if (this.error || !Object.keys(this.categories).length) {
      this.showError(this.error ?? 'No finance news available');
      return;
    }

    const availCats = this.getAvailableCategories();
    // If active category has no items, switch to first available
    if (!this.categories[this.activeCategory]?.items?.length && availCats.length > 0) {
      this.activeCategory = availCats[0]!;
    }

    const items = this.getItems();

    const tabsHtml = availCats.map(cat => {
      const meta = CATEGORY_META[cat];
      const count = this.categories[cat]?.items?.length ?? 0;
      const isAlert = this.categories[cat]?.items?.some(i => i.isAlert) ?? false;
      return `<button class="fn-tab${this.activeCategory === cat ? ' active' : ''}" data-cat="${escapeHtml(cat)}">
        <span class="fn-tab-icon">${meta?.icon ?? '📰'}</span>
        <span class="fn-tab-label">${escapeHtml(meta?.label ?? cat)}</span>
        <span class="fn-tab-count${isAlert ? ' fn-alert-count' : ''}">${count}</span>
      </button>`;
    }).join('');

    const itemsHtml = items.map(item => {
      const timeStr = relTime(item.publishedAt);
      const alertBadge = item.isAlert ? '<span class="fn-alert-badge">⚡ Alert</span>' : '';
      const href = sanitizeUrl(item.link);
      return `
        <a class="fn-item${item.isAlert ? ' fn-item-alert' : ''}" href="${href}" target="_blank" rel="noopener noreferrer">
          <div class="fn-item-header">
            <span class="fn-source">${escapeHtml(item.source)}</span>
            ${alertBadge}
            <span class="fn-time">${timeStr}</span>
          </div>
          <div class="fn-title">${escapeHtml(item.title)}</div>
          ${item.locationName ? `<div class="fn-location">📍 ${escapeHtml(item.locationName)}</div>` : ''}
        </a>`;
    }).join('');

    const content = `
      <div class="fn-container">
        <div class="fn-tabs">${tabsHtml}</div>
        <div class="fn-items">${itemsHtml || '<div class="fn-empty">No articles in this category</div>'}</div>
      </div>`;

    this.setContent(content);

    this.element?.querySelectorAll('.fn-tab').forEach(btn =>
      btn.addEventListener('click', e => {
        const cat = (e.currentTarget as HTMLElement).dataset['cat'];
        if (cat) { this.activeCategory = cat; this.renderPanel(); }
      }),
    );
  }
}
