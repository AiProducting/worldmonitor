/**
 * RPC: ListMarketQuotes
 * Fetches stock/index quotes from Finnhub (stocks) and Yahoo Finance (indices/futures).
 */
import type {
  ServerContext,
  ListMarketQuotesRequest,
  ListMarketQuotesResponse,
} from '../../../../src/generated/server/worldmonitor/market/v1/service_server';
import { YAHOO_ONLY_SYMBOLS, fetchFinnhubQuote, fetchYahooQuotesBatch, parseStringArray } from './_shared';
import { cachedFetchJson, getCachedJson } from '../../../_shared/redis';

const REDIS_CACHE_KEY = 'market:quotes:v1';
const REDIS_CACHE_TTL = 480; // 8 min — shared across all Vercel instances

const quotesCache = new Map<string, { data: ListMarketQuotesResponse; timestamp: number }>();
const QUOTES_CACHE_TTL = 480_000; // 8 minutes (in-memory fallback)

function cacheKey(symbols: string[]): string {
  return [...symbols].sort().join(',');
}

function redisCacheKey(symbols: string[]): string {
  return `${REDIS_CACHE_KEY}:${[...symbols].sort().join(',')}`;
}

export function filterMarketQuotes(
  bootstrap: ListMarketQuotesResponse,
  symbols: string[],
): ListMarketQuotesResponse {
  if (symbols.length === 0) return bootstrap;
  const symbolSet = new Set(symbols);
  return {
    ...bootstrap,
    quotes: bootstrap.quotes.filter((quote) => symbolSet.has(quote.symbol)),
  };
}

export async function listMarketQuotes(
  _ctx: ServerContext,
  req: ListMarketQuotesRequest,
): Promise<ListMarketQuotesResponse> {
  const now = Date.now();
  const parsedSymbols = parseStringArray(req.symbols);
  const key = cacheKey(parsedSymbols);

  // Layer 0: bootstrap/seed data (written by Railway ais-relay)
  try {
    const bootstrap = await getCachedJson(BOOTSTRAP_KEY, true) as ListMarketQuotesResponse | null;
    if (!bootstrap?.quotes?.length) {
      return { quotes: [], finnhubSkipped: false, skipReason: '', rateLimited: false };
    }

    return filterMarketQuotes(bootstrap, parsedSymbols);
  } catch {
    return memCached?.data || { quotes: [], finnhubSkipped: false, skipReason: '', rateLimited: false };
  }
}
