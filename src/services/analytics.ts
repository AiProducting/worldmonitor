/**
 * Analytics facade.
 *
 * PostHog has been removed from the application.
 * Vercel Analytics remains initialized in src/main.ts.
 * Event-level helpers are kept as no-ops to preserve existing call sites.
 */

import { subscribeAuthState } from './auth-state';

// ---------------------------------------------------------------------------
// Type-safe event catalog — every event name lives here.
// Typo in an event string = compile error.
// ---------------------------------------------------------------------------

const EVENTS = {
  // Search
  'search-open': true,
  'search-used': true,
  'search-result-selected': true,
  // Country / map
  'country-selected': true,
  'country-brief-opened': true,
  'map-layer-toggle': true,
  // Panels
  'panel-toggle': true,
  // Settings
  'settings-open': true,
  'variant-switch': true,
  'theme-changed': true,
  'language-change': true,
  'feature-toggle': true,
  // News
  'news-sort-toggle': true,
  'news-summarize': true,
  'live-news-fullscreen': true,
  // Webcams
  'webcam-selected': true,
  'webcam-region-filter': true,
  'webcam-fullscreen': true,
  // Downloads / banners
  'download-clicked': true,
  'critical-banner': true,
  // AI widget
  'widget-ai-open': true,
  'widget-ai-generate': true,
  'widget-ai-success': true,
  // MCP
  'mcp-connect-attempt': true,
  'mcp-connect-success': true,
  'mcp-panel-add': true,
  // Auth (wired in PR #1812 — do not remove)
  'sign-in': true,
  'sign-up': true,
  'sign-out': true,
  'gate-hit': true,
} as const;

export type UmamiEvent = keyof typeof EVENTS;

/** Type-safe Umami wrapper. Safe to call even if the script hasn't loaded. */
export function track(event: UmamiEvent, data?: Record<string, unknown>): void {
  window.umami?.track(event, data);
}

export async function initAnalytics(): Promise<void> {
  // Intentionally no-op.
}

// ---------------------------------------------------------------------------
// User identity — call after auth state resolves so Umami can segment events
// by user/plan. Safe to call before Umami script loads.
// ---------------------------------------------------------------------------

export function identifyUser(userId: string, plan: string): void {
  window.umami?.identify({ userId, plan });
}

export function clearIdentity(): void {
  window.umami?.identify({});
}

let _unsubscribeAuthAnalytics: (() => void) | null = null;

/**
 * Call once after initAuthState() to keep Umami identity in sync with
 * the authenticated user. Re-entrant safe: subsequent calls are no-ops.
 */
export function initAuthAnalytics(): void {
  if (_unsubscribeAuthAnalytics) return;

  _unsubscribeAuthAnalytics = subscribeAuthState((state) => {
    if (state.user) {
      identifyUser(state.user.id, state.user.role);
    } else {
      clearIdentity();
    }
  });
}

// ---------------------------------------------------------------------------
// Auth events
// ---------------------------------------------------------------------------

export function trackSignIn(method: string): void {
  track('sign-in', { method });
}

export function trackSignUp(method: string): void {
  track('sign-up', { method });
}

export function trackSignOut(): void {
  track('sign-out');
}

export function trackGateHit(feature: string): void {
  track('gate-hit', { feature });
}

export function trackApiKeysSnapshot(): void {
  // Intentionally no-op.
}

export function trackLLMUsage(_provider: string, _model: string, _cached: boolean): void {
  // Intentionally no-op.
}

export function trackLLMFailure(_lastProvider: string): void {
  // Intentionally no-op.
}

export function trackPanelResized(_panelId: string, _newSpan: number): void {
  // Intentionally no-op.
}

export function trackVariantSwitch(_from: string, _to: string): void {
  // Intentionally no-op.
}

export function trackMapLayerToggle(_layerId: string, _enabled: boolean, _source: 'user' | 'programmatic'): void {
  // Intentionally no-op.
}

export function trackCountryBriefOpened(_countryCode: string): void {
  // Intentionally no-op.
}

export function trackThemeChanged(_theme: string): void {
  // Intentionally no-op.
}

export function trackLanguageChange(_language: string): void {
  // Intentionally no-op.
}

export function trackFeatureToggle(_featureId: string, _enabled: boolean): void {
  // Intentionally no-op.
}

export function trackSearchUsed(_queryLength: number, _resultCount: number): void {
  // Intentionally no-op.
}

export function trackMapViewChange(_view: string): void {
  // Intentionally no-op.
}

export function trackCountrySelected(_code: string, _name: string, _source: string): void {
  // Intentionally no-op.
}

export function trackSearchResultSelected(_resultType: string): void {
  // Intentionally no-op.
}

export function trackPanelToggled(_panelId: string, _enabled: boolean): void {
  // Intentionally no-op.
}

export function trackFindingClicked(_id: string, _source: string, _type: string, _priority: string): void {
  // Intentionally no-op.
}

export function trackUpdateShown(_current: string, _remote: string): void {
  // Intentionally no-op.
}

export function trackUpdateClicked(_version: string): void {
  // Intentionally no-op.
}

export function trackUpdateDismissed(_version: string): void {
  // Intentionally no-op.
}

export function trackCriticalBannerAction(_action: string, _theaterId: string): void {
  // Intentionally no-op.
}

export function trackDownloadClicked(_platform: string): void {
  // Intentionally no-op.
}

export function trackDownloadBannerDismissed(): void {
  // Intentionally no-op.
}

export function trackWebcamSelected(_webcamId: string, _city: string, _viewMode: string): void {
  // Intentionally no-op.
}

export function trackWebcamRegionFiltered(_region: string): void {
  // Intentionally no-op.
}

export function trackDeeplinkOpened(_type: string, _target: string): void {
  // Intentionally no-op.
}
