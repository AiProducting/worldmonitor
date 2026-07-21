/**
 * RPC: getEnergyCapacity -- EIA Open Data API v2
 * Installed generation capacity data (solar, wind, coal) aggregated to US national totals.
 */
import type {
  ServerContext,
  GetEnergyCapacityRequest,
  GetEnergyCapacityResponse,
  EnergyCapacitySeries,
  EnergyCapacityYear,
} from '../../../../src/generated/server/worldmonitor/economic/v1/service_server';

import { getCachedJson } from '../../../_shared/redis';
import { markNoStoreFallbackResponse } from '../../../_shared/response-headers';

const REDIS_CACHE_KEY = 'economic:capacity:v1';
const REDIS_CACHE_TTL = 86400; // 24h — annual data barely changes
const DEFAULT_YEARS = 20;

interface CapacitySource {
  code: string;
  name: string;
}

const EIA_CAPACITY_SOURCES: CapacitySource[] = [
  { code: 'SUN', name: 'Solar' },
  { code: 'WND', name: 'Wind' },
  { code: 'COL', name: 'Coal' },
];

// Coal sub-type codes used when the aggregate COL code returns no data
const COAL_SUBTYPES = ['BIT', 'SUB', 'LIG', 'RC'];

interface EiaCapabilityRow {
  period?: string;
  stateid?: string;
  capability?: number;
  'capability-units'?: string;
}

/**
 * Fetch installed generation capacity from EIA state electricity profiles.
 * Returns a Map of year -> total US capacity in MW for the given source code.
 */
async function fetchCapacityForSource(
  sourceCode: string,
  apiKey: string,
  startYear: number,
): Promise<Map<number, number>> {
  const params = new URLSearchParams({
    api_key: apiKey,
    'data[]': 'capability',
    frequency: 'annual',
    'facets[energysourceid][]': sourceCode,
    'sort[0][column]': 'period',
    'sort[0][direction]': 'desc',
    length: '5000',
    start: String(startYear),
  });

  const url = `https://api.eia.gov/v2/electricity/state-electricity-profiles/capability/data/?${params}`;
  const response = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': CHROME_UA },
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) return new Map();

  const data = await response.json() as {
    response?: { data?: EiaCapabilityRow[] };
  };

  const rows = data.response?.data;
  if (!rows || rows.length === 0) return new Map();

  // Aggregate state-level data to national totals by year
  const yearTotals = new Map<number, number>();
  for (const row of rows) {
    if (row.period == null || row.capability == null) continue;
    const year = parseInt(row.period, 10);
    if (isNaN(year)) continue;
    const mw = typeof row.capability === 'number' ? row.capability : parseFloat(String(row.capability));
    if (!Number.isFinite(mw)) continue;
    yearTotals.set(year, (yearTotals.get(year) ?? 0) + mw);
  }

  return yearTotals;
}

/**
 * Fetch coal capacity with fallback to specific sub-type codes.
 * EIA capability endpoint may use BIT/SUB/LIG/RC instead of aggregate COL.
 */
async function fetchCoalCapacity(
  apiKey: string,
  startYear: number,
): Promise<Map<number, number>> {
  // Try aggregate COL first
  const colResult = await fetchCapacityForSource('COL', apiKey, startYear);
  if (colResult.size > 0) return colResult;

  // Fallback: fetch individual coal sub-types and merge
  const subResults = await Promise.all(
    COAL_SUBTYPES.map(code => fetchCapacityForSource(code, apiKey, startYear)),
  );

  const merged = new Map<number, number>();
  for (const subMap of subResults) {
    for (const [year, mw] of subMap) {
      merged.set(year, (merged.get(year) ?? 0) + mw);
    }
  }

  return merged;
}

export async function getEnergyCapacity(
  ctx: ServerContext,
  req: GetEnergyCapacityRequest,
): Promise<GetEnergyCapacityResponse> {
  try {
    const result = await getCachedJson(SEED_CACHE_KEY, true) as GetEnergyCapacityResponse | null;
    if (!result?.series?.length) return markNoStoreFallbackResponse(ctx.request, { series: [] });
    if (req.energySources.length > 0) {
      return { series: result.series.filter(s => req.energySources.includes(s.energySource)) };
    }
    return result;
  } catch {
    return markNoStoreFallbackResponse(ctx.request, { series: [] });
  }
}
