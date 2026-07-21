/**
 * RPC: getBisExchangeRates -- BIS SDMX API (WS_EER)
 * Effective exchange rate indices (real + nominal) for major economies.
 */

import type {
  ServerContext,
  GetBisExchangeRatesRequest,
  GetBisExchangeRatesResponse,
  BisExchangeRate,
} from '../../../../src/generated/server/worldmonitor/economic/v1/service_server';

import { getCachedJson } from '../../../_shared/redis';
import { markNoStoreFallbackResponse } from '../../../_shared/response-headers';

const REDIS_CACHE_KEY = 'economic:bis:eer:v1';
const REDIS_CACHE_TTL = 21600; // 6 hours — monthly data

export async function getBisExchangeRates(
  ctx: ServerContext,
  _req: GetBisExchangeRatesRequest,
): Promise<GetBisExchangeRatesResponse> {
  try {
    const result = await getCachedJson(SEED_CACHE_KEY, true) as GetBisExchangeRatesResponse | null;
    return result || markNoStoreFallbackResponse(ctx.request, { rates: [] });
  } catch {
    return markNoStoreFallbackResponse(ctx.request, { rates: [] });
  }
}
