/**
 * RPC: getBisCredit -- BIS SDMX API (WS_TC)
 * Total credit-to-GDP ratio for major economies.
 */

import type {
  ServerContext,
  GetBisCreditRequest,
  GetBisCreditResponse,
  BisCreditToGdp,
} from '../../../../src/generated/server/worldmonitor/economic/v1/service_server';

import { getCachedJson } from '../../../_shared/redis';
import { markNoStoreFallbackResponse } from '../../../_shared/response-headers';

const REDIS_CACHE_KEY = 'economic:bis:credit:v1';
const REDIS_CACHE_TTL = 43200; // 12 hours — quarterly data

export async function getBisCredit(
  ctx: ServerContext,
  _req: GetBisCreditRequest,
): Promise<GetBisCreditResponse> {
  try {
    const result = await getCachedJson(SEED_CACHE_KEY, true) as GetBisCreditResponse | null;
    return result || markNoStoreFallbackResponse(ctx.request, { entries: [] });
  } catch {
    return markNoStoreFallbackResponse(ctx.request, { entries: [] });
  }
}
