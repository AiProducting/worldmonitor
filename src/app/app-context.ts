import type { InternetOutage, SocialUnrestEvent, MilitaryFlight, MilitaryFlightCluster, MilitaryVessel, MilitaryVesselCluster, USNIFleetReport, PanelConfig, MapLayers, NewsItem, MarketData, ClusteredEvent, CyberThreat, Monitor, AisDisruptionEvent } from '@/types';
import type { AirportDelayAlert, PositionSample } from '@/services/aviation';
import type { IranEvent } from '@/generated/client/worldmonitor/conflict/v1/service_client';
import type { ConflictEvent } from '@/services/conflict';
import type { GpsJamHex } from '@/services/gps-interference';

// Geometry-resolved satellite-fire shape ingested into CII. Mirrors the inline
// projection built in DataLoaderManager.loadFirmsData so the cache can replay it
// once precision country geometry is ready (#4512).
export type SatelliteFireSignal = {
  lat: number;
  lon: number;
  brightness: number;
  frp: number;
  region?: string;
};
import type { SanctionsPressureResult } from '@/services/sanctions-pressure';
import type { RadiationWatchResult } from '@/services/radiation';
import type { SecurityAdvisory } from '@/services/security-advisories';
import type { MapContainer, Panel, NewsPanel, SignalModal, StatusPanel, SearchModal } from '@/components';
import type { IntelligenceGapBadge } from '@/components';
import type { MarketData, ClusteredEvent } from '@/types';
import type { PredictionMarket } from '@/services/prediction';
import type { TimeRange } from '@/components';
import type { Earthquake } from '@/services/earthquakes';
import type { CountryBriefPanel } from '@/components/CountryBriefPanel';
import type { CountryTimeline } from '@/components/CountryTimeline';
import type { PlaybackControl } from '@/components';
import type { ExportPanel } from '@/utils';
import type { UnifiedSettings } from '@/components/UnifiedSettings';
import type { PizzIntIndicator, LlmStatusIndicator } from '@/components';
import type { ParsedMapUrlState } from '@/utils';
import type { PositiveNewsFeedPanel } from '@/components/PositiveNewsFeedPanel';
import type { CountersPanel } from '@/components/CountersPanel';
import type { ProgressChartsPanel } from '@/components/ProgressChartsPanel';
import type { BreakthroughsTickerPanel } from '@/components/BreakthroughsTickerPanel';
import type { HeroSpotlightPanel } from '@/components/HeroSpotlightPanel';
import type { GoodThingsDigestPanel } from '@/components/GoodThingsDigestPanel';
import type { SpeciesComebackPanel } from '@/components/SpeciesComebackPanel';
import type { RenewableEnergyPanel } from '@/components/RenewableEnergyPanel';
import type { TvModeController } from '@/services/tv-mode';
import type { BreakingNewsBanner } from '@/components/BreakingNewsBanner';
import type { CorrelationEngine } from '@/services/correlation-engine';

export interface CountryBriefSignals {
  criticalNews: number;
  protests: number;
  militaryFlights: number;
  militaryVessels: number;
  outages: number;
  aisDisruptions: number;
  satelliteFires: number;
  temporalAnomalies: number;
  cyberThreats: number;
  earthquakes: number;
  displacementOutflow: number;
  climateStress: number;
  conflictEvents: number;
  activeStrikes: number;
  orefSirens: number;
  orefHistory24h: number;
  aviationDisruptions: number;
  travelAdvisories: number;
  travelAdvisoryMaxLevel: string | null;
  gpsJammingHexes: number;
  isTier1: boolean;
}

import type { UnifiedSettingsTabId } from '@/components/settings-types';
export type { UnifiedSettingsTabId };

export interface UnifiedSettingsController {
  open(tab?: UnifiedSettingsTabId): void;
  refreshPanelToggles(): void;
  getButton(): HTMLButtonElement;
  destroy(): void;
}

export interface IntelligenceCache {
  conflicts?: ConflictEvent[];
  // Coordinate-resolved sources whose CII attribution depends on precision
  // country geometry. They are ingested during the visible-data fan-out (before
  // geometry is ready, so attribution is coarse/empty) and replayed once
  // geometry lands — see refreshGeometryDependentCiiAfterCountryGeometry (#4512).
  gpsJamming?: GpsJamHex[];
  aisDisruptions?: AisDisruptionEvent[];
  satelliteFires?: SatelliteFireSignal[];
  flightDelays?: AirportDelayAlert[];
  aircraftPositions?: PositionSample[];
  outages?: InternetOutage[];
  protests?: { events: SocialUnrestEvent[]; sources: { acled: number; gdelt: number } };
  military?: { flights: MilitaryFlight[]; flightClusters: MilitaryFlightCluster[]; vessels: MilitaryVessel[]; vesselClusters: MilitaryVesselCluster[] };
  earthquakes?: Earthquake[];
  usniFleet?: USNIFleetReport;
  iranEvents?: IranEvent[];
  orefAlerts?: { alertCount: number; historyCount24h: number };
  advisories?: SecurityAdvisory[];
  imageryScenes?: Array<{ id: string; satellite: string; datetime: string; resolutionM: number; mode: string; geometryGeojson: string; previewUrl: string; assetUrl: string }>;
}

export interface AppModule {
  init(): void | Promise<void>;
  destroy(): void;
}

export interface AppContext {
  map: MapContainer | null;
  readonly isMobile: boolean;
  readonly isDesktopApp: boolean;
  readonly container: HTMLElement;

  panels: Record<string, Panel>;
  newsPanels: Record<string, NewsPanel>;
  panelSettings: Record<string, PanelConfig>;

  mapLayers: MapLayers;

  allNews: NewsItem[];
  newsByCategory: Record<string, NewsItem[]>;
  latestMarkets: MarketData[];
  latestPredictions: import('@/services/prediction').PredictionMarket[];
  latestTechEvents: Array<{ id: string; title: string; location: string; startDate: string; [key: string]: unknown }>;
  latestClusters: ClusteredEvent[];
  intelligenceCache: IntelligenceCache;
  cyberThreatsCache: CyberThreat[] | null;

  disabledSources: Set<string>;
  currentTimeRange: TimeRange;

  inFlight: Set<string>;
  seenGeoAlerts: Set<string>;
  monitors: Monitor[];

  signalModal: import('@/components/SignalModal').SignalModal | null;
  ensureSignalModal: () => Promise<import('@/components/SignalModal').SignalModal>;
  statusPanel: import('@/components').StatusPanel | null;
  searchModal: import('@/components').SearchModal | null;
  findingsBadge: import('@/components').IntelligenceGapBadge | null;
  breakingBanner: import('@/components/BreakingNewsBanner').BreakingNewsBanner | null;
  playbackControl: import('@/components').PlaybackControl | null;
  exportPanel: import('@/utils/export').ExportPanel | null;
  unifiedSettings: UnifiedSettingsController | null;
  pizzintIndicator: import('@/components').PizzIntIndicator | null;
  correlationEngine: import('@/services/correlation-engine').CorrelationEngine | null;
  llmStatusIndicator: import('@/components').LlmStatusIndicator | null;
  countryBriefPage: import('@/components/CountryBriefPanel').CountryBriefPanel | null;
  countryTimeline: import('@/components/CountryTimeline').CountryTimeline | null;

  positivePanel: import('@/components/PositiveNewsFeedPanel').PositiveNewsFeedPanel | null;
  countersPanel: import('@/components/CountersPanel').CountersPanel | null;
  progressPanel: import('@/components/ProgressChartsPanel').ProgressChartsPanel | null;
  breakthroughsPanel: import('@/components/BreakthroughsTickerPanel').BreakthroughsTickerPanel | null;
  heroPanel: import('@/components/HeroSpotlightPanel').HeroSpotlightPanel | null;
  digestPanel: import('@/components/GoodThingsDigestPanel').GoodThingsDigestPanel | null;
  speciesPanel: import('@/components/SpeciesComebackPanel').SpeciesComebackPanel | null;
  renewablePanel: import('@/components/RenewableEnergyPanel').RenewableEnergyPanel | null;
  authModal: { open(): void; close(): void; destroy(): void } | null;
  authHeaderWidget: import('@/components/AuthHeaderWidget').AuthHeaderWidget | null;
  tvMode: import('@/services/tv-mode').TvModeController | null;
  happyAllItems: NewsItem[];
  isDestroyed: boolean;
  isPlaybackMode: boolean;
  isIdle: boolean;
  initialLoadComplete: boolean;
  resolvedLocation: 'global' | 'america' | 'mena' | 'eu' | 'asia' | 'latam' | 'africa' | 'oceania';
  activeChokepoint: string | null;

  initialUrlState: ParsedMapUrlState | null;
  readonly PANEL_ORDER_KEY: string;
  readonly PANEL_SPANS_KEY: string;
}
