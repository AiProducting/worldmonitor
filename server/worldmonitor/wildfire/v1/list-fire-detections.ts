/**
 * ListFireDetections RPC -- proxies the NASA FIRMS CSV API.
 *
 * Fetches active fire detections from all 9 monitored regions in parallel
 * and transforms the FIRMS CSV rows into proto-shaped FireDetection objects.
 *
 * Gracefully degrades to empty results when NASA_FIRMS_API_KEY is not set.
 */
import type {
  WildfireServiceHandler,
  ServerContext,
  ListFireDetectionsRequest,
  ListFireDetectionsResponse,
  FireConfidence,
} from '../../../../src/generated/server/worldmonitor/wildfire/v1/service_server';

import { getCachedJson } from '../../../_shared/redis';
import { limitFireDetectionsForDashboard } from '../../../../api/_wildfire-dashboard.js';
export { WILDFIRE_DASHBOARD_DETECTION_LIMIT, limitFireDetectionsForDashboard } from '../../../../api/_wildfire-dashboard.js';

const COMPACT_SEED_CACHE_KEY = 'wildfire:fires-bootstrap:v1';
const COMPACT_SEED_META_KEY = 'seed-meta:wildfire:fires-bootstrap';
const CANONICAL_SEED_CACHE_KEY = 'wildfire:fires:v1';
const CANONICAL_SEED_META_KEY = 'seed-meta:wildfire:fires';

interface SeedMeta {
  fetchedAt?: number;
}

export const listFireDetections: WildfireServiceHandler['listFireDetections'] = async (
  _ctx: ServerContext,
  _req: ListFireDetectionsRequest,
): Promise<ListFireDetectionsResponse> => {
  try {
    let [result, meta] = await Promise.all([
      getCachedJson(COMPACT_SEED_CACHE_KEY, true) as Promise<Partial<ListFireDetectionsResponse> | null>,
      getCachedJson(COMPACT_SEED_META_KEY, true) as Promise<SeedMeta | null>,
    ]);

    // Keep deploy ordering safe: the RPC can serve the canonical seed until the
    // compact extra-key writer has published its first payload.
    if (!result) {
      [result, meta] = await Promise.all([
        getCachedJson(CANONICAL_SEED_CACHE_KEY, true) as Promise<Partial<ListFireDetectionsResponse> | null>,
        getCachedJson(CANONICAL_SEED_META_KEY, true) as Promise<SeedMeta | null>,
      ]);
    }

    if (!result) return { fireDetections: [], pagination: undefined, fetchedAt: 0, dataAvailable: false };
    const rawDetections = result.fireDetections ?? [];
    const fireDetections = limitFireDetectionsForDashboard(rawDetections);
    const capped = fireDetections.length < rawDetections.length;

    return {
      fireDetections,
      pagination: capped ? { nextCursor: '', totalCount: rawDetections.length } : result.pagination,
      fetchedAt: Number(result.fetchedAt || meta?.fetchedAt || 0),
      dataAvailable: true,
    };
  } catch {
    return { fireDetections: [], pagination: undefined, fetchedAt: 0, dataAvailable: false };
  }
  return result || { fireDetections: [], pagination: undefined };
};
