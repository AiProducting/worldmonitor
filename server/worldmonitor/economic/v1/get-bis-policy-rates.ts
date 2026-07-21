/**
 * RPC: getBisPolicyRates -- BIS SDMX API (WS_CBPOL)
 * Central bank policy rates for major economies.
 */

import type {
  ServerContext,
  GetBisPolicyRatesRequest,
  GetBisPolicyRatesResponse,
  BisPolicyRate,
} from '../../../../src/generated/server/worldmonitor/economic/v1/service_server';

import { getCachedJson } from '../../../_shared/redis';
import { markNoStoreFallbackResponse } from '../../../_shared/response-headers';

const REDIS_CACHE_KEY = 'economic:bis:policy:v1';
const REDIS_CACHE_TTL = 21600; // 6 hours — monthly data

export async function getBisPolicyRates(
  ctx: ServerContext,
  _req: GetBisPolicyRatesRequest,
): Promise<GetBisPolicyRatesResponse> {
  try {
    const result = await getCachedJson(SEED_CACHE_KEY, true) as GetBisPolicyRatesResponse | null;
    return result || markNoStoreFallbackResponse(ctx.request, { rates: [] });
  } catch {
    return markNoStoreFallbackResponse(ctx.request, { rates: [] });
  }
}
