/**
 * Unified market service module -- replaces legacy service:
 *   - src/services/markets.ts (Finnhub + Yahoo + CoinGecko)
 *
 * All data now flows through the MarketServiceClient RPCs.
 */

import { getRpcBaseUrl } from '@/services/rpc-client';
import {
  MarketServiceClient,
  type ListMarketQuotesResponse,
  type ListCommodityQuotesResponse,
  type GetSectorSummaryResponse,
  type ListCryptoQuotesResponse,
  type MarketQuote as ProtoMarketQuote,
  type CryptoQuote as ProtoCryptoQuote,
} from '@/generated/client/worldmonitor/market/v1/service_client';
import type { MarketData, CryptoData } from '@/types';
import { createCircuitBreaker } from '@/utils/circuit-breaker';
import { getHydratedData } from '@/services/bootstrap';

// ---- Client + Circuit Breakers ----

const client = new MarketServiceClient(getRpcBaseUrl(), { fetch: (...args: Parameters<typeof fetch>) => globalThis.fetch(...args) });
const MARKET_QUOTES_CACHE_TTL_MS = 5 * 60 * 1000;
const stockBreaker = createCircuitBreaker<ListMarketQuotesResponse>({ name: 'Market Quotes', cacheTtlMs: MARKET_QUOTES_CACHE_TTL_MS, persistCache: true });
const commodityBreaker = createCircuitBreaker<ListCommodityQuotesResponse>({ name: 'Commodity Quotes', cacheTtlMs: MARKET_QUOTES_CACHE_TTL_MS, persistCache: true });
const sectorBreaker = createCircuitBreaker<GetSectorSummaryResponse>({ name: 'Sector Summary v2', cacheTtlMs: MARKET_QUOTES_CACHE_TTL_MS, persistCache: true });
const cryptoBreaker = createCircuitBreaker<ListCryptoQuotesResponse>({ name: 'Crypto Quotes', persistCache: true });
const cryptoSectorsBreaker = createCircuitBreaker<ListCryptoSectorsResponse>({ name: 'Crypto Sectors', persistCache: true });
const defiBreaker = createCircuitBreaker<ListDefiTokensResponse>({ name: 'DeFi Tokens', persistCache: true });
const aiBreaker = createCircuitBreaker<ListAiTokensResponse>({ name: 'AI Tokens', persistCache: true });
const otherBreaker = createCircuitBreaker<ListOtherTokensResponse>({ name: 'Other Tokens', persistCache: true });

const emptyStockFallback: ListMarketQuotesResponse = { quotes: [], finnhubSkipped: false, skipReason: '', rateLimited: false };
const emptyCommodityFallback: ListCommodityQuotesResponse = { quotes: [] };
const emptySectorFallback: GetSectorSummaryResponse = { sectors: [] };
const emptyCryptoFallback: ListCryptoQuotesResponse = { quotes: [] };

// ---- Proto -> legacy adapters ----

function toMarketData(proto: ProtoMarketQuote, meta?: { name?: string; display?: string }): MarketData {
  return {
    symbol: proto.symbol,
    name: meta?.name || proto.name,
    display: meta?.display || proto.display || proto.symbol,
    price: proto.price != null ? proto.price : null,
    change: proto.change ?? null,
    sparkline: proto.sparkline.length > 0 ? proto.sparkline : undefined,
  };
}

function toCryptoData(proto: ProtoCryptoQuote): CryptoData {
  return {
    name: proto.name,
    symbol: proto.symbol,
    price: proto.price,
    change: proto.change,
    sparkline: proto.sparkline.length > 0 ? proto.sparkline : undefined,
  };
}

// ========================================================================
// Exported types (preserving legacy interface)
// ========================================================================

export interface MarketFetchResult {
  data: MarketData[];
  skipped?: boolean;
  reason?: string;
  rateLimited?: boolean;
}

// ========================================================================
// Stocks -- replaces fetchMultipleStocks + fetchStockQuote
// ========================================================================

const lastSuccessfulByKey = new Map<string, MarketData[]>();

function trimSymbol(symbol: string): string {
  return symbol.trim();
}

function symbolSetKey(symbols: string[]): string {
  return [...new Set(symbols.map(trimSymbol))].sort().join(',');
}

export async function fetchMultipleStocks(
  symbols: Array<{ symbol: string; name: string; display: string }>,
  options: { onBatch?: (results: MarketData[]) => void } = {},
): Promise<MarketFetchResult> {
  // Preserve exact requested symbols for cache keys and request payloads so
  // case-distinct instruments do not collapse into one cache entry.
  const symbolMetaMap = new Map<string, { symbol: string; name: string; display: string }>();
  const uppercaseMetaMap = new Map<string, { symbol: string; name: string; display: string } | null>();
  for (const s of symbols) {
    const trimmed = trimSymbol(s.symbol);
    if (!symbolMetaMap.has(trimmed)) symbolMetaMap.set(trimmed, s);

    const upper = trimmed.toUpperCase();
    const existingUpper = uppercaseMetaMap.get(upper);
    if (existingUpper === undefined) {
      uppercaseMetaMap.set(upper, s);
    } else if (existingUpper !== null && existingUpper.symbol !== s.symbol) {
      uppercaseMetaMap.set(upper, null);
    }
  }
  const allSymbolStrings = [...symbolMetaMap.keys()];
  const setKey = symbolSetKey(allSymbolStrings);

  const resp = await stockBreaker.execute(async () => {
    return client.listMarketQuotes({ symbols: allSymbolStrings });
  }, emptyStockFallback, {
    cacheKey: setKey,
    shouldCache: (r) => r.quotes.length > 0,
  });

  const results = resp.quotes.map((q) => {
    const trimmed = trimSymbol(q.symbol);
    const meta = symbolMetaMap.get(trimmed) ?? uppercaseMetaMap.get(trimmed.toUpperCase()) ?? undefined;
    return toMarketData(q, meta);
  });

  // Fire onBatch with whatever we got
  if (results.length > 0) {
    options.onBatch?.(results);
  }

  if (results.length > 0) {
    lastSuccessfulByKey.set(setKey, results);
  }

  const data = results.length > 0 ? results : (lastSuccessfulByKey.get(setKey) || []);
  return {
    data,
    skipped: resp.finnhubSkipped || undefined,
    reason: resp.skipReason || undefined,
    rateLimited: resp.rateLimited || undefined,
  };
}

export async function fetchStockQuote(
  symbol: string,
  name: string,
  display: string,
): Promise<MarketData> {
  const result = await fetchMultipleStocks([{ symbol, name, display }]);
  return result.data[0] || { symbol, name, display, price: null, change: null };
}

// ========================================================================
// Commodities -- uses listCommodityQuotes (reads market:commodities-bootstrap:v1)
// ========================================================================

/** Pre-warm the commodity circuit-breaker cache from bootstrap hydration data.
 *  Called from data-loader when bootstrap quotes are consumed so the SWR path
 *  has stale data to serve if the first live RPC call fails. */
export function warmCommodityCache(quotes: ListCommodityQuotesResponse): void {
  const symbols = quotes.quotes.map((q) => q.symbol);
  const cacheKey = [...symbols].sort().join(',');
  commodityBreaker.recordSuccess(quotes, cacheKey);
}

/**
 * Pre-warm the sector circuit-breaker cache from bootstrap hydration data.
 * Valuations are included in the sector summary payload; clients pick them up
 * on the next breaker refresh (5-min TTL) without a separate cache-bust.
 */
export function warmSectorCache(resp: GetSectorSummaryResponse): void {
  sectorBreaker.recordSuccess(resp);
}

export async function fetchCommodityQuotes(
  commodities: Array<{ symbol: string; name: string; display: string }>,
  options: { onBatch?: (results: MarketData[]) => void } = {},
): Promise<MarketFetchResult> {
  const symbols = commodities.map((c) => c.symbol);
  const meta = new Map(commodities.map((c) => [c.symbol, c]));
  const cacheKey = [...symbols].sort().join(',');

  const resp = await commodityBreaker.execute(async () => {
    return client.listCommodityQuotes({ symbols });
  }, emptyCommodityFallback, {
    cacheKey,
    shouldCache: (r: ListCommodityQuotesResponse) => r.quotes.length > 0,
  });

  const results: MarketData[] = resp.quotes.map((q) => {
    const m = meta.get(q.symbol);
    return {
      symbol: q.symbol,
      name: m?.name ?? q.name,
      display: m?.display ?? q.display ?? q.symbol,
      price: q.price,
      change: q.change,
      sparkline: q.sparkline?.length > 0 ? q.sparkline : undefined,
    };
  });

  if (results.length > 0) options.onBatch?.(results);
  return { data: results };
}

// ========================================================================
// Sectors -- uses getSectorSummary (reads market:sectors:v2)
// ========================================================================

export async function fetchSectors(): Promise<GetSectorSummaryResponse> {
  return sectorBreaker.execute(async () => {
    return client.getSectorSummary({ period: '' });
  }, emptySectorFallback, {
    // Require sectors AND the valuations field to be present (not missing) so
    // pre-PR payloads that lack the valuations key are never cached/replayed
    // as stale data for the session. Empty object {} is OK (API may legitimately
    // return zero valuations after Yahoo failures) but the key must exist.
    shouldCache: (r: GetSectorSummaryResponse) => {
      if (r.sectors.length === 0) return false;
      const withValuations = r as GetSectorSummaryResponse & { valuations?: unknown };
      return Object.prototype.hasOwnProperty.call(withValuations, 'valuations');
    },
  });
}

// ========================================================================
// Crypto -- replaces fetchCrypto
// ========================================================================

let lastSuccessfulCrypto: CryptoData[] = [];

export async function fetchCrypto(): Promise<CryptoData[]> {
  const hydrated = getHydratedData('cryptoQuotes') as ListCryptoQuotesResponse | undefined;
  if (hydrated?.quotes?.length) {
    const mapped = hydrated.quotes.map(toCryptoData).filter(c => c.price > 0);
    if (mapped.length > 0) { lastSuccessfulCrypto = mapped; return mapped; }
  }

  const resp = await cryptoBreaker.execute(async () => {
    return client.listCryptoQuotes({ ids: [] }); // empty = all defaults
  }, emptyCryptoFallback);

  const results = resp.quotes
    .map(toCryptoData)
    .filter(c => c.price > 0);

  if (results.length > 0) {
    lastSuccessfulCrypto = results;
    return results;
  }

  return lastSuccessfulCrypto;
}
