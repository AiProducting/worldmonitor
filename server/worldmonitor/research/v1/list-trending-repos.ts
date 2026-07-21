/**
 * RPC: listTrendingRepos
 *
 * Fetches trending GitHub repos from gitterapp JSON API with
 * herokuapp fallback. Returns empty array on any failure.
 */

import type {
  ServerContext,
  ListTrendingReposRequest,
  ListTrendingReposResponse,
  GithubRepo,
} from '../../../../src/generated/server/worldmonitor/research/v1/service_server';

import { clampInt } from '../../../_shared/constants';
import { getCachedJson } from '../../../_shared/redis';
import { markNoStoreFallbackResponse } from '../../../_shared/response-headers';

const REDIS_CACHE_KEY = 'research:trending:v1';
const REDIS_CACHE_TTL = 3600; // 1 hr — daily trending data

// ---------- Fetch ----------

async function fetchTrendingRepos(req: ListTrendingReposRequest): Promise<GithubRepo[]> {
  const language = req.language || 'python';
  const period = req.period || 'daily';
  const pageSize = clampInt(req.pageSize, 50, 1, 100);

  // Primary API
  const primaryUrl = `https://api.gitterapp.com/repositories?language=${language}&since=${period}`;
  let data: any[];

  try {
    const response = await fetch(primaryUrl, {
      headers: { Accept: 'application/json', 'User-Agent': CHROME_UA },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) throw new Error('Primary API failed');
    data = await response.json() as any[];
  } catch {
    // Fallback API
    try {
      const fallbackUrl = `https://gh-trending-api.herokuapp.com/repositories/${language}?since=${period}`;
      const fallbackResponse = await fetch(fallbackUrl, {
        headers: { Accept: 'application/json', 'User-Agent': CHROME_UA },
        signal: AbortSignal.timeout(10000),
      });

      if (!fallbackResponse.ok) return [];
      data = await fallbackResponse.json() as any[];
    } catch {
      return [];
    }
  }

  if (!Array.isArray(data)) return [];

  return data.slice(0, pageSize).map((raw: any): GithubRepo => ({
    fullName: `${raw.author}/${raw.name}`,
    description: raw.description || '',
    language: raw.language || '',
    stars: raw.stars || 0,
    starsToday: raw.currentPeriodStars || 0,
    forks: raw.forks || 0,
    url: raw.url || `https://github.com/${raw.author}/${raw.name}`,
  }));
}

// ---------- Handler ----------

export async function listTrendingRepos(
  ctx: ServerContext,
  req: ListTrendingReposRequest,
): Promise<ListTrendingReposResponse> {
  try {
    const language = req.language || 'python';
    const period = req.period || 'daily';
    const pageSize = clampInt(req.pageSize, 50, 1, 100);
    const seedKey = `${SEED_KEY_PREFIX}:${language}:${period}:50`;
    const result = await getCachedJson(seedKey, true) as ListTrendingReposResponse | null;
    if (!result?.repos?.length) return markNoStoreFallbackResponse(ctx.request, { repos: [], pagination: undefined });
    return { repos: result.repos.slice(0, pageSize), pagination: undefined };
  } catch {
    return markNoStoreFallbackResponse(ctx.request, { repos: [], pagination: undefined });
  }
}
