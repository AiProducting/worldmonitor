/**
 * ListClimateAnomalies RPC -- reads seeded climate data from Railway seed cache.
 * All external Open-Meteo API calls happen in the climate seed scripts on Railway.
 */

import type {
  ClimateServiceHandler,
  ServerContext,
  ListClimateAnomaliesRequest,
  ListClimateAnomaliesResponse,
  AnomalySeverity,
  AnomalyType,
  ClimateAnomaly,
} from '../../../../src/generated/server/worldmonitor/climate/v1/service_server';

import { getCachedJson } from '../../../_shared/redis';
import { CLIMATE_ANOMALIES_KEY } from '../../../_shared/cache-keys';
import { markNoStoreFallbackResponse } from '../../../_shared/response-headers';

export const listClimateAnomalies: ClimateServiceHandler['listClimateAnomalies'] = async (
  ctx: ServerContext,
  _req: ListClimateAnomaliesRequest,
): Promise<ListClimateAnomaliesResponse> => {
  const seeded = await trySeededData();
  if (seeded) return { anomalies: seeded.anomalies, pagination: undefined };

  let result: ListClimateAnomaliesResponse | null = null;
  try {
    const result = await getCachedJson(CLIMATE_ANOMALIES_KEY, true) as ListClimateAnomaliesResponse | null;
    if (!result?.anomalies) {
      return markNoStoreFallbackResponse(ctx.request, { anomalies: [], pagination: undefined });
    }
    return { anomalies: result.anomalies, pagination: result.pagination };
  } catch {
    return markNoStoreFallbackResponse(ctx.request, { anomalies: [], pagination: undefined });
  }
  return result || { anomalies: [], pagination: undefined };
};
